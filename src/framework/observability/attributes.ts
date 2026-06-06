import { createHash } from 'node:crypto';
import type {
  GuardedAutoHealSkipReason,
  GuardedValidationPolicyBlockReason,
  GuardedValidationStatus,
  SelfHealingActionType,
  SelfHealingMode,
  SelfHealingSuggestionStrategy,
} from '../selfHealing/types';
import type { TelemetryAttributes } from './telemetry';

export const SPAN_NAMES = Object.freeze({
  pageAction: 'auroraflow.page_action',
  redisOperation: 'auroraflow.redis.operation',
  selfHealingCapture: 'auroraflow.self_healing.capture',
  guardedValidation: 'auroraflow.self_healing.guarded_validation',
} as const);

export type PageActionMetricStatus = 'succeeded' | 'failed' | 'self_healed';
export type RedisOperationStatus = 'succeeded' | 'failed';
export type GuardedAutoHealMetricStatus = 'succeeded' | 'failed' | 'skipped';
export type GuardedValidationMetricStatus =
  | GuardedValidationStatus
  | GuardedValidationPolicyBlockReason;

export interface PageActionTelemetryInput {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  target?: string;
  runId: string;
  testId?: string;
  exportRawTarget: boolean;
}

export interface PageActionMetricInput {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  status: PageActionMetricStatus;
  errorCode?: string;
}

export interface RedisOperationTelemetryInput {
  operationName: string;
  status?: RedisOperationStatus;
}

export interface SelfHealingCaptureTelemetryInput {
  mode: SelfHealingMode;
  actionType: SelfHealingActionType;
  pageObjectName: string;
  runId: string;
  testId?: string;
  target?: string;
  exportRawTarget: boolean;
}

export interface SelfHealingArtifactMetricInput {
  mode: SelfHealingMode;
  actionType: SelfHealingActionType;
}

export interface SelfHealingSuggestionMetricInput {
  strategy: SelfHealingSuggestionStrategy;
}

export interface GuardedValidationTelemetryInput {
  actionType: SelfHealingActionType;
  minConfidence: number;
  currentUrl?: string;
}

export interface GuardedValidationMetricInput {
  status: GuardedValidationMetricStatus;
  strategy?: SelfHealingSuggestionStrategy;
}

export interface GuardedAutoHealMetricInput {
  actionType: SelfHealingActionType;
  status: GuardedAutoHealMetricStatus;
  skippedReason?: GuardedAutoHealSkipReason;
}

function normalizeTelemetryString(value: string): string {
  return value.trim().slice(0, 256);
}

export function hashTelemetryValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function resolveTargetKind(target: string | undefined): string {
  if (target === undefined || target.trim() === '') {
    return 'unknown';
  }
  const normalized = target.trim();
  if (/^https?:\/\//i.test(normalized)) {
    return 'url';
  }
  if (/^\/\//.test(normalized) || normalized.startsWith('xpath=')) {
    return 'xpath';
  }
  if (normalized.startsWith('page.getBy')) {
    return 'playwright-locator';
  }
  if (/^[.#[]/.test(normalized) || normalized.includes(' >> ')) {
    return 'css';
  }
  return 'text-or-selector';
}

function normalizeOperationName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_');
  return normalized.slice(0, 64) || 'unknown';
}

export function buildPageActionSpanAttributes({
  pageObjectName,
  actionType,
  target,
  runId,
  testId,
  exportRawTarget,
}: PageActionTelemetryInput): TelemetryAttributes {
  const attributes: Record<string, string | number | boolean | undefined> = {
    'auroraflow.page_object': normalizeTelemetryString(pageObjectName),
    'auroraflow.action.type': actionType,
    'auroraflow.action.target_kind': resolveTargetKind(target),
    'auroraflow.run_id': normalizeTelemetryString(runId),
    'auroraflow.test_id': testId === undefined ? undefined : normalizeTelemetryString(testId),
  };

  if (target !== undefined && target.trim() !== '') {
    attributes['auroraflow.action.target_hash'] = hashTelemetryValue(target);
    if (exportRawTarget) {
      attributes['auroraflow.action.target'] = normalizeTelemetryString(target);
    }
  }

  return attributes;
}

export function buildPageActionMetricAttributes({
  pageObjectName,
  actionType,
  status,
  errorCode,
}: PageActionMetricInput): TelemetryAttributes {
  return {
    'auroraflow.page_object': normalizeTelemetryString(pageObjectName),
    'auroraflow.action.type': actionType,
    'auroraflow.action.status': status,
    'error.code': errorCode,
  };
}

export function buildRedisOperationSpanAttributes({
  operationName,
  status,
}: RedisOperationTelemetryInput): TelemetryAttributes {
  return {
    'auroraflow.redis.operation': normalizeOperationName(operationName),
    'auroraflow.redis.operation.status': status,
  };
}

export function buildRedisOperationMetricAttributes({
  operationName,
  status,
}: Required<RedisOperationTelemetryInput>): TelemetryAttributes {
  return {
    'auroraflow.redis.operation': normalizeOperationName(operationName),
    'auroraflow.redis.operation.status': status,
  };
}

export function buildSelfHealingCaptureSpanAttributes({
  mode,
  actionType,
  pageObjectName,
  runId,
  testId,
  target,
  exportRawTarget,
}: SelfHealingCaptureTelemetryInput): TelemetryAttributes {
  const attributes: Record<string, string | number | boolean | undefined> = {
    'auroraflow.self_heal.mode': mode,
    'auroraflow.action.type': actionType,
    'auroraflow.page_object': normalizeTelemetryString(pageObjectName),
    'auroraflow.action.target_kind': resolveTargetKind(target),
    'auroraflow.run_id': normalizeTelemetryString(runId),
    'auroraflow.test_id': testId === undefined ? undefined : normalizeTelemetryString(testId),
  };

  if (target !== undefined && target.trim() !== '') {
    attributes['auroraflow.action.target_hash'] = hashTelemetryValue(target);
    if (exportRawTarget) {
      attributes['auroraflow.action.target'] = normalizeTelemetryString(target);
    }
  }

  return attributes;
}

export function buildSelfHealingArtifactMetricAttributes({
  mode,
  actionType,
}: SelfHealingArtifactMetricInput): TelemetryAttributes {
  return {
    'auroraflow.self_heal.mode': mode,
    'auroraflow.action.type': actionType,
  };
}

export function buildSelfHealingSuggestionMetricAttributes({
  strategy,
}: SelfHealingSuggestionMetricInput): TelemetryAttributes {
  return {
    'auroraflow.self_heal.strategy': strategy,
  };
}

export function buildGuardedValidationSpanAttributes({
  actionType,
  minConfidence,
  currentUrl,
}: GuardedValidationTelemetryInput): TelemetryAttributes {
  const attributes: Record<string, string | number | boolean | undefined> = {
    'auroraflow.self_heal.mode': 'dry-run',
    'auroraflow.action.type': actionType,
    'auroraflow.self_heal.min_confidence': minConfidence,
  };

  if (currentUrl !== undefined && currentUrl.trim() !== '') {
    attributes['auroraflow.current_url_hash'] = hashTelemetryValue(currentUrl);
  }

  return attributes;
}

export function buildGuardedValidationMetricAttributes({
  status,
  strategy,
}: GuardedValidationMetricInput): TelemetryAttributes {
  return {
    'auroraflow.self_heal.status': status,
    'auroraflow.self_heal.strategy': strategy ?? 'none',
  };
}

export function buildGuardedAutoHealMetricAttributes({
  actionType,
  status,
  skippedReason,
}: GuardedAutoHealMetricInput): TelemetryAttributes {
  return {
    'auroraflow.action.type': actionType,
    'auroraflow.self_heal.status': status,
    'auroraflow.self_heal.skip_reason': skippedReason,
  };
}
