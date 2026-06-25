import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CapturedFailureError,
  CapturedFailureEvent,
  SelfHealingActionContext,
  SelfHealingSuggestion,
} from './types';
import { SelfHealingConfig } from './types';
import { generateRankedLocatorSuggestions } from './suggestionEngine';
import {
  normalizeOptionalIdentifier,
  resolveCorrelationIdentifiers,
} from '../observability/correlation';
import {
  SPAN_NAMES,
  buildSelfHealingArtifactMetricAttributes,
  buildSelfHealingCaptureSpanAttributes,
} from '../observability/attributes';
import { METRIC_NAMES } from '../observability/metricNames';
import { getTelemetry, type AuroraFlowTelemetry } from '../observability/telemetry';
import { DEFAULT_ARTIFACT_PRIVACY_POLICY, type ArtifactPrivacyPolicy } from './artifactPrivacy';

export type FailureArtifactWriter = (event: CapturedFailureEvent) => Promise<void>;
export const DEFAULT_SELF_HEALING_ARTIFACTS_DIR = path.join('test-results', 'self-healing');
export const SELF_HEAL_ARTIFACTS_DIR_ENV = 'SELF_HEAL_ARTIFACTS_DIR';

export interface CaptureFailureEventInput {
  config: SelfHealingConfig;
  pageObjectName: string;
  action: SelfHealingActionContext;
  error: unknown;
  currentUrl?: string;
  screenshotPath?: string;
  privacyPolicy?: ArtifactPrivacyPolicy;
  suggestions?: ReadonlyArray<SelfHealingSuggestion>;
  writer?: FailureArtifactWriter;
  decorateEvent?: (event: CapturedFailureEvent) => Promise<void> | void;
  correlation?: {
    runId?: string;
    testId?: string;
    component?: string;
    errorCode?: string;
  };
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  randomSuffix?: () => string;
  telemetry?: AuroraFlowTelemetry;
}

function normalizeError(error: unknown): CapturedFailureError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}

function buildEventId(now: Date, randomSuffix: string): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const suffix = randomSuffix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return `${timestamp}_${suffix || 'event'}`;
}

export function createFileFailureArtifactWriter(
  outputDirectory: string = DEFAULT_SELF_HEALING_ARTIFACTS_DIR,
): FailureArtifactWriter {
  return async (event: CapturedFailureEvent): Promise<void> => {
    await mkdir(outputDirectory, { recursive: true });
    const filePath = path.join(outputDirectory, `${event.eventId}.json`);
    await writeFile(filePath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  };
}

export function resolveFailureArtifactOutputDirectory(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env[SELF_HEAL_ARTIFACTS_DIR_ENV]?.trim() || DEFAULT_SELF_HEALING_ARTIFACTS_DIR;
}

export async function captureFailureEvent({
  config,
  pageObjectName,
  action,
  error,
  currentUrl,
  screenshotPath,
  privacyPolicy = DEFAULT_ARTIFACT_PRIVACY_POLICY,
  suggestions: inputSuggestions,
  writer,
  decorateEvent,
  correlation,
  env = process.env,
  now = () => new Date(),
  randomSuffix = () => randomUUID(),
  telemetry: inputTelemetry,
}: CaptureFailureEventInput): Promise<CapturedFailureEvent | null> {
  if (config.mode === 'off') {
    return null;
  }

  const { runId, testId } = resolveCorrelationIdentifiers({
    correlation: {
      runId: correlation?.runId,
      testId: correlation?.testId,
    },
    env,
  });
  const telemetry = inputTelemetry ?? getTelemetry();
  const artifactWriter =
    writer ?? createFileFailureArtifactWriter(resolveFailureArtifactOutputDirectory(env));

  return telemetry.runSpan({
    name: SPAN_NAMES.selfHealingCapture,
    attributes: buildSelfHealingCaptureSpanAttributes({
      mode: config.mode,
      actionType: action.type,
      pageObjectName,
      runId,
      testId,
      target: action.target,
      exportRawTarget: telemetry.config.exportRawSelectors,
    }),
    task: async (span) => {
      const occurredAt = now();
      const suggestions = [
        ...(inputSuggestions ??
          generateRankedLocatorSuggestions({
            actionType: action.type,
            failedTarget: action.target,
            telemetry,
          })),
      ];
      const component = normalizeOptionalIdentifier(correlation?.component) ?? pageObjectName;
      const errorCode = normalizeOptionalIdentifier(correlation?.errorCode) ?? 'page_action_error';
      const event: CapturedFailureEvent = {
        artifactVersion: '1.0.0',
        eventId: buildEventId(occurredAt, randomSuffix()),
        timestamp: occurredAt.toISOString(),
        runId,
        testId,
        component,
        errorCode,
        mode: config.mode,
        minConfidence: config.minConfidence,
        safetyPolicy: config.safetyPolicy,
        pageObjectName,
        currentUrl,
        screenshotPath: privacyPolicy.screenshot.mode === 'capture' ? screenshotPath : undefined,
        action,
        error: normalizeError(error),
        suggestions,
      };

      if (decorateEvent) {
        await decorateEvent(event);
      }

      await artifactWriter(event);
      span.setAttribute('auroraflow.self_heal.suggestion_count', suggestions.length);
      span.setAttribute('auroraflow.self_heal.artifact_written', true);
      telemetry.recordCounter(
        METRIC_NAMES.selfHealingArtifactsTotal,
        1,
        buildSelfHealingArtifactMetricAttributes({
          mode: config.mode,
          actionType: action.type,
        }),
      );
      return event;
    },
  });
}
