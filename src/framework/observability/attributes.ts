import { createHash } from 'node:crypto';
import type { SelfHealingActionType } from '../selfHealing/types';
import type { TelemetryAttributes } from './telemetry';

export const SPAN_NAMES = Object.freeze({
  pageAction: 'auroraflow.page_action',
} as const);

export type PageActionMetricStatus = 'succeeded' | 'failed' | 'self_healed';

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
