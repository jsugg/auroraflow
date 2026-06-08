import { createHash } from 'node:crypto';
import {
  buildSelfHealingRegistryWriteMetricAttributes,
  type SelfHealingRegistryWriteMetricStatus,
  type SelfHealingRegistryWriteOperation,
} from '../observability/attributes';
import { METRIC_NAMES } from '../observability/metricNames';
import { getTelemetry } from '../observability/telemetry';
import type {
  SelectorCandidateHistoryObservation,
  SelfHealingRegistryRuntime,
} from './registryContracts';
import type {
  CapturedFailureEvent,
  GuardedValidationCandidate,
  PendingSelectorPromotion,
  PendingSelectorPromotionWriteResult,
  RankedSelfHealingCandidate,
  SelectorCandidateHistoryWriteResult,
  SelfHealingConfig,
  SelfHealingRegistryPersistenceSummary,
} from './types';

export const DEFAULT_PENDING_SELECTOR_PROMOTION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface PersistSelfHealingRegistryTelemetryInput {
  config: SelfHealingConfig;
  event: CapturedFailureEvent;
  registryRuntime?: SelfHealingRegistryRuntime;
  pendingPromotionTtlSeconds?: number;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('self-healing event timestamp must be an ISO timestamp.');
  }
  return new Date(timestampMs + seconds * 1000).toISOString();
}

function normalizeTtlSeconds(ttlSeconds: number): number {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('pending promotion ttlSeconds must be a positive integer.');
  }
  return ttlSeconds;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeSkippedPromotion(
  event: CapturedFailureEvent,
  reason: string,
): PendingSelectorPromotionWriteResult {
  return {
    eventId: event.eventId,
    status: 'skipped',
    reason,
  };
}

function emptySummary(
  event: CapturedFailureEvent,
  config: SelfHealingConfig,
  reason: string,
): SelfHealingRegistryPersistenceSummary {
  const candidates = event.sat?.candidates ?? [];
  return {
    mode: config.sat.registryMode,
    history: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: candidates.length,
      observations: candidates.map((candidate) => ({
        candidateId: candidate.id,
        selectorId: event.action.selectorId ?? candidate.registryRecordId,
        status: 'skipped',
        reason,
      })),
    },
    promotion: writeSkippedPromotion(event, reason),
    warnings: reason === 'registry_mode_not_write_pending' ? [] : [reason],
  };
}

function buildValidationByLocator(
  event: CapturedFailureEvent,
): ReadonlyMap<string, GuardedValidationCandidate> {
  const validationByLocator = new Map<string, GuardedValidationCandidate>();
  for (const candidate of event.guardedValidation?.candidates ?? []) {
    validationByLocator.set(candidate.locator, candidate);
  }
  return validationByLocator;
}

async function recordHistoryObservations({
  event,
  runtime,
}: {
  event: CapturedFailureEvent;
  runtime: SelfHealingRegistryRuntime;
}): Promise<{
  observations: SelectorCandidateHistoryWriteResult[];
  warnings: string[];
}> {
  const candidates = event.sat?.candidates ?? [];
  if (candidates.length === 0) {
    return { observations: [], warnings: [] };
  }

  if (!runtime.histories.recordObservation) {
    return {
      observations: candidates.map((candidate) => ({
        candidateId: candidate.id,
        selectorId: event.action.selectorId ?? candidate.registryRecordId,
        status: 'skipped',
        reason: 'history_repository_read_only',
      })),
      warnings: ['Candidate history repository does not support writes.'],
    };
  }

  const validationByLocator = buildValidationByLocator(event);
  const observations: SelectorCandidateHistoryWriteResult[] = [];
  const warnings: string[] = [];

  for (const candidate of candidates) {
    const validation = validationByLocator.get(candidate.locator);
    const guardedAutoHealMatches = event.guardedAutoHeal?.locator === candidate.locator;
    const observation: SelectorCandidateHistoryObservation = {
      candidate,
      eventId: event.eventId,
      observedAt: event.timestamp,
      selectorId: event.action.selectorId ?? candidate.registryRecordId,
      validationStatus: validation?.status,
      validationAccepted: validation?.status === 'accepted',
      guardedApplySucceeded: guardedAutoHealMatches && event.guardedAutoHeal?.succeeded === true,
      guardedApplyFailed:
        guardedAutoHealMatches &&
        event.guardedAutoHeal?.attempted === true &&
        event.guardedAutoHeal?.succeeded === false,
    };

    try {
      const history = await runtime.histories.recordObservation(observation);
      observations.push({
        candidateId: candidate.id,
        selectorId: observation.selectorId,
        status: 'succeeded',
        validationStatus: observation.validationStatus,
        validationAccepted: observation.validationAccepted,
        guardedApplySucceeded: observation.guardedApplySucceeded,
        guardedApplyFailed: observation.guardedApplyFailed,
        attempts: history.attempts,
        validated: history.validated,
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      warnings.push(`Candidate history write failed for ${candidate.id}: ${message}`);
      observations.push({
        candidateId: candidate.id,
        selectorId: observation.selectorId,
        status: 'failed',
        validationStatus: observation.validationStatus,
        validationAccepted: observation.validationAccepted,
        guardedApplySucceeded: observation.guardedApplySucceeded,
        guardedApplyFailed: observation.guardedApplyFailed,
        errorMessage: message,
      });
    }
  }

  return { observations, warnings };
}

function findAcceptedRankedCandidate(
  event: CapturedFailureEvent,
): RankedSelfHealingCandidate | undefined {
  const acceptedLocator = event.guardedValidation?.acceptedLocator;
  if (!acceptedLocator) {
    return undefined;
  }
  return event.sat?.candidates.find((candidate) => candidate.locator === acceptedLocator);
}

function findActiveRegistryCandidate({
  candidates,
  selectorId,
}: {
  candidates: readonly RankedSelfHealingCandidate[];
  selectorId: string;
}): RankedSelfHealingCandidate | undefined {
  return candidates.find(
    (candidate) =>
      candidate.registryRecordId === selectorId &&
      candidate.registryRecordVersion !== undefined &&
      candidate.evidence.source === 'registry',
  );
}

function buildPendingPromotion({
  event,
  acceptedCandidate,
  selectorId,
  baseSelectorVersion,
  ttlSeconds,
}: {
  event: CapturedFailureEvent;
  acceptedCandidate: RankedSelfHealingCandidate;
  selectorId: string;
  baseSelectorVersion: number;
  ttlSeconds: number;
}): PendingSelectorPromotion {
  const promotionId = `promotion:${event.eventId}:${shortHash(acceptedCandidate.id)}`;
  return {
    promotionId,
    eventId: event.eventId,
    candidateId: acceptedCandidate.id,
    selectorId,
    proposedLocator: acceptedCandidate.locator,
    locator: acceptedCandidate.locator,
    baseSelectorVersion,
    confidence: acceptedCandidate.score,
    status: 'pending',
    requestedAt: event.timestamp,
    expiresAt: addSeconds(event.timestamp, ttlSeconds),
    runId: event.runId,
    testId: event.testId,
    pageObjectName: event.pageObjectName,
    actionType: event.action.type,
    acknowledged: false,
  };
}

async function writePendingPromotion({
  event,
  runtime,
  pendingPromotionTtlSeconds,
}: {
  event: CapturedFailureEvent;
  runtime: SelfHealingRegistryRuntime;
  pendingPromotionTtlSeconds: number;
}): Promise<{
  promotion: PendingSelectorPromotionWriteResult;
  warning?: string;
}> {
  if (event.guardedAutoHeal?.succeeded !== true) {
    return {
      promotion: writeSkippedPromotion(event, 'guarded_auto_heal_not_succeeded'),
    };
  }

  const acceptedCandidate = findAcceptedRankedCandidate(event);
  if (!acceptedCandidate) {
    return {
      promotion: writeSkippedPromotion(event, 'accepted_candidate_not_ranked'),
    };
  }

  const selectorId = event.action.selectorId ?? acceptedCandidate.registryRecordId;
  if (!selectorId) {
    return {
      promotion: writeSkippedPromotion(event, 'missing_selector_id'),
    };
  }

  const activeCandidate = findActiveRegistryCandidate({
    candidates: event.sat?.candidates ?? [],
    selectorId,
  });
  if (!activeCandidate || activeCandidate.registryRecordVersion === undefined) {
    return {
      promotion: writeSkippedPromotion(event, 'missing_base_selector_version'),
    };
  }

  if (activeCandidate.locator === acceptedCandidate.locator) {
    return {
      promotion: writeSkippedPromotion(event, 'accepted_locator_already_active'),
    };
  }

  const promotion = buildPendingPromotion({
    event,
    acceptedCandidate,
    selectorId,
    baseSelectorVersion: activeCandidate.registryRecordVersion,
    ttlSeconds: pendingPromotionTtlSeconds,
  });

  try {
    const persisted = await runtime.promotions.upsert(promotion);
    return {
      promotion: {
        eventId: event.eventId,
        status: 'succeeded',
        promotionId: persisted.promotionId,
        candidateId: persisted.candidateId,
        selectorId: persisted.selectorId,
      },
    };
  } catch (error: unknown) {
    const message = errorMessage(error);
    return {
      promotion: {
        eventId: event.eventId,
        status: 'failed',
        promotionId: promotion.promotionId,
        candidateId: promotion.candidateId,
        selectorId: promotion.selectorId,
        errorMessage: message,
      },
      warning: `Pending promotion write failed for ${promotion.promotionId}: ${message}`,
    };
  }
}

function recordWriteMetric({
  config,
  event,
  operation,
  status,
}: {
  config: SelfHealingConfig;
  event: CapturedFailureEvent;
  operation: SelfHealingRegistryWriteOperation;
  status: SelfHealingRegistryWriteMetricStatus;
}): void {
  getTelemetry().recordCounter(
    METRIC_NAMES.selfHealingRegistryWritesTotal,
    1,
    buildSelfHealingRegistryWriteMetricAttributes({
      actionType: event.action.type,
      mode: config.sat.registryMode,
      operation,
      status,
    }),
  );
}

/** Persists review telemetry for write-pending SAT without mutating active selectors. */
export async function persistSelfHealingRegistryTelemetry({
  config,
  event,
  registryRuntime,
  pendingPromotionTtlSeconds = DEFAULT_PENDING_SELECTOR_PROMOTION_TTL_SECONDS,
}: PersistSelfHealingRegistryTelemetryInput): Promise<SelfHealingRegistryPersistenceSummary> {
  if (config.sat.registryMode !== 'write_pending') {
    return emptySummary(event, config, 'registry_mode_not_write_pending');
  }
  const normalizedPendingPromotionTtlSeconds = normalizeTtlSeconds(pendingPromotionTtlSeconds);

  if (!registryRuntime) {
    const summary = emptySummary(event, config, 'registry_runtime_unavailable');
    recordWriteMetric({
      config,
      event,
      operation: 'pending_promotion',
      status: 'skipped',
    });
    return summary;
  }

  const { observations, warnings } = await recordHistoryObservations({
    event,
    runtime: registryRuntime,
  });
  for (const observation of observations) {
    recordWriteMetric({
      config,
      event,
      operation: 'history_observation',
      status: observation.status,
    });
  }

  const { promotion, warning } = await writePendingPromotion({
    event,
    runtime: registryRuntime,
    pendingPromotionTtlSeconds: normalizedPendingPromotionTtlSeconds,
  });
  if (warning) {
    warnings.push(warning);
  }
  recordWriteMetric({
    config,
    event,
    operation: 'pending_promotion',
    status: promotion.status,
  });

  return {
    mode: config.sat.registryMode,
    history: {
      attempted: observations.filter((observation) => observation.status !== 'skipped').length,
      succeeded: observations.filter((observation) => observation.status === 'succeeded').length,
      failed: observations.filter((observation) => observation.status === 'failed').length,
      skipped: observations.filter((observation) => observation.status === 'skipped').length,
      observations,
    },
    promotion,
    warnings,
  };
}
