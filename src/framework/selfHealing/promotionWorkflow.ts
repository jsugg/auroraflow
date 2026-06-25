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
import {
  PromotionAuthorizationError,
  createPromotionAuthorizationPolicy,
  type PromotionAuthorizationDecision,
  type PromotionAuthorizationMode,
  type PromotionAuthorizationPolicy,
} from './promotionAuthorization';
import type { PendingSelectorPromotion, PendingSelectorPromotionStatus } from './types';

export const DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const MAX_PROMOTION_AUDIT_RETENTION_SECONDS = 30 * 24 * 60 * 60;

type PromotionIdentifier = {
  eventId?: string;
  promotionId?: string;
};

type PromotionAuditAction = 'approve' | 'reject' | 'rollback';
type PromotionWorkflowStatus = 'applied' | 'rejected' | 'rolled_back' | 'conflict';

interface PromotionAuditRecord {
  authorizationMode: PromotionAuthorizationMode;
  authorizationWarnings?: readonly string[];
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
  expiresAt?: string;
  legalHold?: boolean;
}

type PromotionAuditWriteInput = Omit<
  PromotionAuditRecord,
  'authorizationMode' | 'authorizationWarnings'
> & {
  authorization: PromotionAuthorizationDecision;
};

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
  authorizationMode: PromotionAuthorizationMode;
  authorizationWarnings: readonly string[];
  promotion: PendingSelectorPromotion;
  status: PromotionWorkflowStatus;
}

export interface SelfHealingPromotionWorkflowOptions {
  activeNamespace?: string;
  auditRetentionSeconds?: number;
  authorizationPolicy?: PromotionAuthorizationPolicy;
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

function addSeconds(timestamp: string, seconds: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new Error('timestamp must be an ISO timestamp.');
  }
  return new Date(parsed + seconds * 1_000).toISOString();
}

function normalizeAuditRetentionSeconds(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('auditRetentionSeconds must be a positive integer.');
  }
  return Math.min(value, MAX_PROMOTION_AUDIT_RETENTION_SECONDS);
}

/** Reviewed selector-promotion workflow over store-backed registry persistence. */
export class SelfHealingPromotionWorkflow {
  private readonly activeNamespace: string;

  private readonly auditRetentionSeconds: number;

  private readonly authorizationPolicy: PromotionAuthorizationPolicy;

  private readonly historyRepository: StoreSelectorCandidateHistoryRepository;

  private readonly now: () => Date;

  private readonly promotionRepository: StorePendingSelectorPromotionRepository;

  private readonly selectorRepository: SelectorRegistryRepository;

  private readonly store: SelectorStore;

  private readonly auditNamespace: string;

  public constructor({
    store,
    activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
    auditRetentionSeconds,
    authorizationPolicy = createPromotionAuthorizationPolicy(),
    now = () => new Date(),
  }: SelfHealingPromotionWorkflowOptions) {
    this.store = store;
    this.now = now;
    this.activeNamespace = activeNamespace;
    this.auditRetentionSeconds = normalizeAuditRetentionSeconds(auditRetentionSeconds);
    this.authorizationPolicy = authorizationPolicy;
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
    const authorization = await this.authorizeMutation('approve', reviewer, promotion);
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
        expectedStatus: 'pending',
        reviewer,
        reviewedAt,
        reason: `Active selector version ${activeRecord.version} does not match expected version ${promotion.baseSelectorVersion}.`,
      });
      await this.writeAudit({
        authorization,
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
      return this.buildResult(conflictedPromotion, 'conflict', authorization);
    }

    const claimedPromotion = await this.transitionPromotionStatus(
      promotion,
      'pending',
      (current) => ({
        ...current,
        status: 'approved',
        acknowledged: false,
        reviewedBy: reviewer,
        reviewedAt,
        conflictReason: undefined,
      }),
    );

    try {
      const nextRecord = await this.selectorRepository.upsert(
        {
          id: activeRecord.id,
          pageObjectName: activeRecord.pageObjectName,
          actionType: activeRecord.actionType,
          locator: claimedPromotion.proposedLocator,
          strategy: activeRecord.strategy,
          confidence: claimedPromotion.confidence,
          notes: activeRecord.notes,
        },
        { expectedVersion: activeRecord.version },
      );
      const updatedPromotion = await this.transitionPromotionStatus(
        claimedPromotion,
        'approved',
        (current) => ({
          ...current,
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
        }),
      );
      await this.recordOutcome({
        candidateId: claimedPromotion.candidateId,
        observedAt: reviewedAt,
        promoted: 1,
      });
      await this.writeAudit({
        authorization,
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
      return this.buildResult(updatedPromotion, 'applied', authorization);
    } catch (error: unknown) {
      if (!(error instanceof SelectorRegistryConflictError)) {
        throw error;
      }
      const conflictedPromotion = await this.persistConflict({
        promotion: claimedPromotion,
        expectedStatus: 'approved',
        reviewer,
        reviewedAt,
        reason: error.message,
      });
      await this.writeAudit({
        authorization,
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
      return this.buildResult(conflictedPromotion, 'conflict', authorization);
    }
  }

  public async reject(input: RejectPromotionInput): Promise<PromotionWorkflowResult> {
    const reviewer = normalizeRequiredText(input.reviewer, 'reviewer');
    const reason = normalizeRequiredText(input.reason, 'reason');
    const promotion = await this.loadPromotion(input);
    const authorization = await this.authorizeMutation('reject', reviewer, promotion);
    if (promotion.status !== 'pending') {
      throw new Error(`Only pending promotions can be rejected. Received ${promotion.status}.`);
    }

    const reviewedAt = this.now().toISOString();
    const updatedPromotion = await this.transitionPromotionStatus(
      promotion,
      'pending',
      (current) => ({
        ...current,
        status: 'rejected',
        acknowledged: true,
        reviewedBy: reviewer,
        reviewedAt,
        reviewReason: reason,
        conflictReason: undefined,
      }),
    );
    await this.recordOutcome({
      candidateId: promotion.candidateId,
      observedAt: reviewedAt,
      rejected: 1,
    });
    await this.writeAudit({
      authorization,
      promotionId: updatedPromotion.promotionId,
      eventId: updatedPromotion.eventId,
      selectorId: updatedPromotion.selectorId,
      action: 'reject',
      status: 'rejected',
      reviewer,
      reviewedAt,
      reason,
    });
    return this.buildResult(updatedPromotion, 'rejected', authorization);
  }

  public async rollback(input: RollbackPromotionInput): Promise<PromotionWorkflowResult> {
    const reviewer = normalizeRequiredText(input.reviewer, 'reviewer');
    const promotion = await this.loadPromotion(input);
    const authorization = await this.authorizeMutation('rollback', reviewer, promotion);
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
        expectedStatus: 'applied',
        reviewer,
        reviewedAt,
        reason: `Active selector version ${activeRecord.version} does not match applied version ${promotion.appliedSelectorVersion}.`,
      });
      await this.writeAudit({
        authorization,
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
      return this.buildResult(conflictedPromotion, 'conflict', authorization);
    }

    const claimedPromotion = await this.transitionPromotionStatus(
      promotion,
      'applied',
      (current) => ({
        ...current,
        status: 'approved',
        reviewedBy: reviewer,
        reviewedAt,
        reviewReason: normalizeOptionalText(input.reason) ?? current.reviewReason,
        conflictReason: undefined,
      }),
    );

    try {
      const restoredRecord = await this.selectorRepository.upsert(
        {
          id: activeRecord.id,
          pageObjectName: activeRecord.pageObjectName,
          actionType: activeRecord.actionType,
          locator: promotion.previousLocator,
          strategy: claimedPromotion.previousStrategy ?? activeRecord.strategy,
          confidence: claimedPromotion.previousConfidence ?? activeRecord.confidence,
          notes: claimedPromotion.previousNotes ?? activeRecord.notes,
        },
        { expectedVersion: activeRecord.version },
      );
      const updatedPromotion = await this.transitionPromotionStatus(
        claimedPromotion,
        'approved',
        (current) => ({
          ...current,
          status: 'rolled_back',
          reviewedBy: reviewer,
          reviewedAt,
          reviewReason: normalizeOptionalText(input.reason) ?? current.reviewReason,
          rolledBackAt: reviewedAt,
          conflictReason: undefined,
        }),
      );
      await this.recordOutcome({
        candidateId: claimedPromotion.candidateId,
        observedAt: reviewedAt,
        rolledBack: 1,
      });
      await this.writeAudit({
        authorization,
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
      return this.buildResult(updatedPromotion, 'rolled_back', authorization);
    } catch (error: unknown) {
      if (!(error instanceof SelectorRegistryConflictError)) {
        throw error;
      }
      const conflictedPromotion = await this.persistConflict({
        promotion: claimedPromotion,
        expectedStatus: 'approved',
        reviewer,
        reviewedAt,
        reason: error.message,
      });
      await this.writeAudit({
        authorization,
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
      return this.buildResult(conflictedPromotion, 'conflict', authorization);
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

  private async authorizeMutation(
    action: PromotionAuditAction,
    reviewer: string,
    promotion: PendingSelectorPromotion,
  ): Promise<PromotionAuthorizationDecision> {
    const decision = await this.authorizationPolicy.authorize({
      action,
      activeNamespace: this.activeNamespace,
      evidence: { codeownersPresent: false, protectedWorkflow: false },
      promotion,
      reviewer,
    });
    if (!decision.allowed) {
      throw new PromotionAuthorizationError(decision);
    }
    return decision;
  }

  private buildResult(
    promotion: PendingSelectorPromotion,
    status: PromotionWorkflowStatus,
    authorization: PromotionAuthorizationDecision,
  ): PromotionWorkflowResult {
    return {
      authorizationMode: authorization.mode,
      authorizationWarnings: authorization.warnings,
      promotion,
      status,
    };
  }

  private async transitionPromotionStatus(
    promotion: PendingSelectorPromotion,
    expectedStatus: PendingSelectorPromotionStatus,
    buildNextPromotion: (current: PendingSelectorPromotion) => PendingSelectorPromotion,
  ): Promise<PendingSelectorPromotion> {
    return this.promotionRepository.transitionStatus(
      promotion.eventId,
      expectedStatus,
      buildNextPromotion,
    );
  }

  private async persistConflict({
    promotion,
    expectedStatus,
    reviewer,
    reviewedAt,
    reason,
  }: {
    promotion: PendingSelectorPromotion;
    expectedStatus: PendingSelectorPromotionStatus;
    reviewer: string;
    reviewedAt: string;
    reason: string;
  }): Promise<PendingSelectorPromotion> {
    return this.transitionPromotionStatus(promotion, expectedStatus, (current) => ({
      ...current,
      status: 'conflict',
      acknowledged: true,
      reviewedBy: reviewer,
      reviewedAt,
      conflictReason: reason,
    }));
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

  private async writeAudit(record: PromotionAuditWriteInput): Promise<void> {
    const auditKey = `${this.auditNamespace}:${record.promotionId}:${record.action}:${record.reviewedAt}`;
    const { authorization, ...auditFields } = record;
    const expiresAt = record.expiresAt ?? addSeconds(record.reviewedAt, this.auditRetentionSeconds);
    const auditRecord: PromotionAuditRecord = {
      ...auditFields,
      authorizationMode: authorization.mode,
      authorizationWarnings: authorization.warnings,
      expiresAt,
    };
    await this.store.set(auditKey, JSON.stringify(auditRecord), {
      ttlSeconds: this.auditRetentionSeconds,
    });
  }
}
