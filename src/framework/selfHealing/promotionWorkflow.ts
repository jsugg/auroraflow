import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  SelectorRegistryConflictError,
  SelectorRegistryRepository,
  buildSelectorRegistryNamespaces,
  type SelectorRecord,
  type SelectorStore,
} from '../../data/selectors/selectorRegistry';
import {
  StoreSelectorCandidateHistoryRepository,
  type SelectorCandidateHistoryOutcomeUpdate,
} from './historyRepository';
import {
  StorePendingSelectorPromotionRepository,
  type StorePendingSelectorPromotionRepositoryOptions,
} from './promotionRepository';
import type { PendingSelectorPromotion } from './types';

type PromotionIdentifier = {
  eventId?: string;
  promotionId?: string;
};

type PromotionAuditAction = 'approve' | 'reject' | 'rollback';
type PromotionWorkflowStatus = 'applied' | 'rejected' | 'rolled_back' | 'conflict';

interface PromotionAuditRecord {
  promotionId: string;
  eventId: string;
  selectorId: string;
  action: PromotionAuditAction;
  status: PromotionWorkflowStatus;
  reviewer: string;
  reviewedAt: string;
  reason?: string;
  previousRecord?: SelectorRecord;
  nextRecord?: SelectorRecord;
}

export interface PromotionWorkflowListQuery {
  candidateId?: string;
  includeAcknowledged?: boolean;
  limit?: number;
  selectorId?: string;
}

export interface PromotionWorkflowListResult {
  promotions: readonly PendingSelectorPromotion[];
  statusCounts: Readonly<Record<string, number>>;
}

export interface ApprovePromotionInput extends PromotionIdentifier {
  reviewer: string;
}

export interface RejectPromotionInput extends PromotionIdentifier {
  reason: string;
  reviewer: string;
}

export interface RollbackPromotionInput extends PromotionIdentifier {
  reason?: string;
  reviewer: string;
}

export interface PromotionWorkflowResult {
  promotion: PendingSelectorPromotion;
  status: PromotionWorkflowStatus;
}

export interface SelfHealingPromotionWorkflowOptions {
  activeNamespace?: string;
  now?: () => Date;
  store: SelectorStore;
}

function normalizeRequiredText(value: string | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must be non-empty.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/** Reviewed selector-promotion workflow over store-backed registry persistence. */
export class SelfHealingPromotionWorkflow {
  private readonly historyRepository: StoreSelectorCandidateHistoryRepository;

  private readonly now: () => Date;

  private readonly promotionRepository: StorePendingSelectorPromotionRepository;

  private readonly selectorRepository: SelectorRegistryRepository;

  private readonly store: SelectorStore;

  private readonly auditNamespace: string;

  public constructor({
    store,
    activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
    now = () => new Date(),
  }: SelfHealingPromotionWorkflowOptions) {
    this.store = store;
    this.now = now;
    this.selectorRepository = new SelectorRegistryRepository({
      store,
      namespace: activeNamespace,
      now,
    });
    this.historyRepository = new StoreSelectorCandidateHistoryRepository({
      store,
      activeNamespace,
    });
    this.promotionRepository = new StorePendingSelectorPromotionRepository({
      store,
      activeNamespace,
    } satisfies StorePendingSelectorPromotionRepositoryOptions);
    this.auditNamespace = buildSelectorRegistryNamespaces(activeNamespace).audit;
  }

  public async list(query: PromotionWorkflowListQuery = {}): Promise<PromotionWorkflowListResult> {
    const promotions = await this.promotionRepository.list(query);
    const statusCounts = promotions.reduce<Record<string, number>>((counter, promotion) => {
      counter[promotion.status] = (counter[promotion.status] ?? 0) + 1;
      return counter;
    }, {});
    return { promotions, statusCounts };
  }

  public async approve(input: ApprovePromotionInput): Promise<PromotionWorkflowResult> {
    const reviewer = normalizeRequiredText(input.reviewer, 'reviewer');
    const promotion = await this.loadPromotion(input);
    if (promotion.status !== 'pending') {
      throw new Error(`Only pending promotions can be approved. Received ${promotion.status}.`);
    }

    const reviewedAt = this.now().toISOString();
    const activeRecord = await this.requireActiveSelectorRecord(promotion.selectorId);
    if (promotion.baseSelectorVersion === undefined) {
      throw new Error(`Promotion ${promotion.promotionId} is missing baseSelectorVersion.`);
    }

    if (activeRecord.version !== promotion.baseSelectorVersion) {
      const conflictedPromotion = await this.persistConflict({
        promotion,
        reviewer,
        reviewedAt,
        reason: `Active selector version ${activeRecord.version} does not match expected version ${promotion.baseSelectorVersion}.`,
      });
      await this.writeAudit({
        promotionId: conflictedPromotion.promotionId,
        eventId: conflictedPromotion.eventId,
        selectorId: conflictedPromotion.selectorId,
        action: 'approve',
        status: 'conflict',
        reviewer,
        reviewedAt,
        reason: conflictedPromotion.conflictReason,
        previousRecord: activeRecord,
      });
      return { promotion: conflictedPromotion, status: 'conflict' };
    }

    try {
      const nextRecord = await this.selectorRepository.upsert(
        {
          id: activeRecord.id,
          pageObjectName: activeRecord.pageObjectName,
          actionType: activeRecord.actionType,
          locator: promotion.proposedLocator,
          strategy: activeRecord.strategy,
          confidence: promotion.confidence,
          notes: activeRecord.notes,
        },
        { expectedVersion: activeRecord.version },
      );
      const updatedPromotion: PendingSelectorPromotion = {
        ...promotion,
        status: 'applied',
        acknowledged: true,
        reviewedBy: reviewer,
        reviewedAt,
        appliedAt: reviewedAt,
        appliedSelectorVersion: nextRecord.version,
        previousLocator: activeRecord.locator,
        previousConfidence: activeRecord.confidence,
        previousStrategy: activeRecord.strategy,
        previousNotes: activeRecord.notes,
        conflictReason: undefined,
      };
      await this.promotionRepository.upsert(updatedPromotion);
      await this.recordOutcome({
        candidateId: promotion.candidateId,
        observedAt: reviewedAt,
        promoted: 1,
      });
      await this.writeAudit({
        promotionId: updatedPromotion.promotionId,
        eventId: updatedPromotion.eventId,
        selectorId: updatedPromotion.selectorId,
        action: 'approve',
        status: 'applied',
        reviewer,
        reviewedAt,
        previousRecord: activeRecord,
        nextRecord,
      });
      return { promotion: updatedPromotion, status: 'applied' };
    } catch (error: unknown) {
      if (!(error instanceof SelectorRegistryConflictError)) {
        throw error;
      }
      const conflictedPromotion = await this.persistConflict({
        promotion,
        reviewer,
        reviewedAt,
        reason: error.message,
      });
      await this.writeAudit({
        promotionId: conflictedPromotion.promotionId,
        eventId: conflictedPromotion.eventId,
        selectorId: conflictedPromotion.selectorId,
        action: 'approve',
        status: 'conflict',
        reviewer,
        reviewedAt,
        reason: error.message,
        previousRecord: activeRecord,
      });
      return { promotion: conflictedPromotion, status: 'conflict' };
    }
  }

  public async reject(input: RejectPromotionInput): Promise<PromotionWorkflowResult> {
    const reviewer = normalizeRequiredText(input.reviewer, 'reviewer');
    const reason = normalizeRequiredText(input.reason, 'reason');
    const promotion = await this.loadPromotion(input);
    if (promotion.status !== 'pending') {
      throw new Error(`Only pending promotions can be rejected. Received ${promotion.status}.`);
    }

    const reviewedAt = this.now().toISOString();
    const updatedPromotion: PendingSelectorPromotion = {
      ...promotion,
      status: 'rejected',
      acknowledged: true,
      reviewedBy: reviewer,
      reviewedAt,
      reviewReason: reason,
      conflictReason: undefined,
    };
    await this.promotionRepository.upsert(updatedPromotion);
    await this.recordOutcome({
      candidateId: promotion.candidateId,
      observedAt: reviewedAt,
      rejected: 1,
    });
    await this.writeAudit({
      promotionId: updatedPromotion.promotionId,
      eventId: updatedPromotion.eventId,
      selectorId: updatedPromotion.selectorId,
      action: 'reject',
      status: 'rejected',
      reviewer,
      reviewedAt,
      reason,
    });
    return { promotion: updatedPromotion, status: 'rejected' };
  }

  public async rollback(input: RollbackPromotionInput): Promise<PromotionWorkflowResult> {
    const reviewer = normalizeRequiredText(input.reviewer, 'reviewer');
    const promotion = await this.loadPromotion(input);
    if (promotion.status !== 'applied') {
      throw new Error(`Only applied promotions can be rolled back. Received ${promotion.status}.`);
    }
    if (promotion.appliedSelectorVersion === undefined) {
      throw new Error(`Promotion ${promotion.promotionId} is missing appliedSelectorVersion.`);
    }
    if (!promotion.previousLocator) {
      throw new Error(`Promotion ${promotion.promotionId} is missing previous locator snapshot.`);
    }

    const reviewedAt = this.now().toISOString();
    const activeRecord = await this.requireActiveSelectorRecord(promotion.selectorId);
    if (activeRecord.version !== promotion.appliedSelectorVersion) {
      const conflictedPromotion = await this.persistConflict({
        promotion,
        reviewer,
        reviewedAt,
        reason: `Active selector version ${activeRecord.version} does not match applied version ${promotion.appliedSelectorVersion}.`,
      });
      await this.writeAudit({
        promotionId: conflictedPromotion.promotionId,
        eventId: conflictedPromotion.eventId,
        selectorId: conflictedPromotion.selectorId,
        action: 'rollback',
        status: 'conflict',
        reviewer,
        reviewedAt,
        reason: conflictedPromotion.conflictReason,
        previousRecord: activeRecord,
      });
      return { promotion: conflictedPromotion, status: 'conflict' };
    }

    try {
      const restoredRecord = await this.selectorRepository.upsert(
        {
          id: activeRecord.id,
          pageObjectName: activeRecord.pageObjectName,
          actionType: activeRecord.actionType,
          locator: promotion.previousLocator,
          strategy: promotion.previousStrategy ?? activeRecord.strategy,
          confidence: promotion.previousConfidence ?? activeRecord.confidence,
          notes: promotion.previousNotes ?? activeRecord.notes,
        },
        { expectedVersion: activeRecord.version },
      );
      const updatedPromotion: PendingSelectorPromotion = {
        ...promotion,
        status: 'rolled_back',
        reviewedBy: reviewer,
        reviewedAt,
        reviewReason: normalizeOptionalText(input.reason) ?? promotion.reviewReason,
        rolledBackAt: reviewedAt,
        conflictReason: undefined,
      };
      await this.promotionRepository.upsert(updatedPromotion);
      await this.recordOutcome({
        candidateId: promotion.candidateId,
        observedAt: reviewedAt,
        rolledBack: 1,
      });
      await this.writeAudit({
        promotionId: updatedPromotion.promotionId,
        eventId: updatedPromotion.eventId,
        selectorId: updatedPromotion.selectorId,
        action: 'rollback',
        status: 'rolled_back',
        reviewer,
        reviewedAt,
        reason: updatedPromotion.reviewReason,
        previousRecord: activeRecord,
        nextRecord: restoredRecord,
      });
      return { promotion: updatedPromotion, status: 'rolled_back' };
    } catch (error: unknown) {
      if (!(error instanceof SelectorRegistryConflictError)) {
        throw error;
      }
      const conflictedPromotion = await this.persistConflict({
        promotion,
        reviewer,
        reviewedAt,
        reason: error.message,
      });
      await this.writeAudit({
        promotionId: conflictedPromotion.promotionId,
        eventId: conflictedPromotion.eventId,
        selectorId: conflictedPromotion.selectorId,
        action: 'rollback',
        status: 'conflict',
        reviewer,
        reviewedAt,
        reason: error.message,
        previousRecord: activeRecord,
      });
      return { promotion: conflictedPromotion, status: 'conflict' };
    }
  }

  private async loadPromotion(identifier: PromotionIdentifier): Promise<PendingSelectorPromotion> {
    const eventId = normalizeOptionalText(identifier.eventId);
    const promotionId = normalizeOptionalText(identifier.promotionId);
    if (!eventId && !promotionId) {
      throw new Error('eventId or promotionId is required.');
    }

    const promotion =
      (eventId ? await this.promotionRepository.get(eventId) : null) ??
      (promotionId ? await this.promotionRepository.findByPromotionId(promotionId) : null);
    if (!promotion) {
      throw new Error(`Promotion not found for ${promotionId ?? eventId}.`);
    }
    return promotion;
  }

  private async persistConflict({
    promotion,
    reviewer,
    reviewedAt,
    reason,
  }: {
    promotion: PendingSelectorPromotion;
    reviewer: string;
    reviewedAt: string;
    reason: string;
  }): Promise<PendingSelectorPromotion> {
    const conflictedPromotion: PendingSelectorPromotion = {
      ...promotion,
      status: 'conflict',
      acknowledged: true,
      reviewedBy: reviewer,
      reviewedAt,
      conflictReason: reason,
    };
    await this.promotionRepository.upsert(conflictedPromotion);
    return conflictedPromotion;
  }

  private async requireActiveSelectorRecord(selectorId: string): Promise<SelectorRecord> {
    const record = await this.selectorRepository.get(selectorId);
    if (!record) {
      throw new Error(`Active selector ${selectorId} does not exist.`);
    }
    return record;
  }

  private async recordOutcome(outcome: SelectorCandidateHistoryOutcomeUpdate): Promise<void> {
    await this.historyRepository.recordOutcome(outcome);
  }

  private async writeAudit(record: PromotionAuditRecord): Promise<void> {
    const auditKey = `${this.auditNamespace}:${record.promotionId}:${record.action}:${record.reviewedAt}`;
    await this.store.set(auditKey, JSON.stringify(record));
  }
}
