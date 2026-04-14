import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CapturedFailureError, CapturedFailureEvent, SelfHealingActionContext } from './types';
import { SelfHealingConfig } from './types';
import { generateRankedLocatorSuggestions } from './suggestionEngine';

export type FailureArtifactWriter = (event: CapturedFailureEvent) => Promise<void>;

export interface CaptureFailureEventInput {
  config: SelfHealingConfig;
  pageObjectName: string;
  action: SelfHealingActionContext;
  error: unknown;
  currentUrl?: string;
  screenshotPath?: string;
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

function normalizeOptionalIdentifier(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const normalized = rawValue.trim();
  return normalized === '' ? undefined : normalized;
}

function resolveRunId({
  correlationRunId,
  env,
}: {
  correlationRunId: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): string {
  return (
    normalizeOptionalIdentifier(correlationRunId) ??
    normalizeOptionalIdentifier(env.AURORAFLOW_RUN_ID) ??
    normalizeOptionalIdentifier(env.GITHUB_RUN_ID) ??
    'local-run'
  );
}

function resolveTestId({
  correlationTestId,
  env,
}: {
  correlationTestId: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  return (
    normalizeOptionalIdentifier(correlationTestId) ??
    normalizeOptionalIdentifier(env.AURORAFLOW_TEST_ID) ??
    normalizeOptionalIdentifier(env.PLAYWRIGHT_TEST_ID)
  );
}

export function createFileFailureArtifactWriter(
  outputDirectory: string = path.join('test-results', 'self-healing'),
): FailureArtifactWriter {
  return async (event: CapturedFailureEvent): Promise<void> => {
    await mkdir(outputDirectory, { recursive: true });
    const filePath = path.join(outputDirectory, `${event.eventId}.json`);
    await writeFile(filePath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  };
}

export async function captureFailureEvent({
  config,
  pageObjectName,
  action,
  error,
  currentUrl,
  screenshotPath,
  writer = createFileFailureArtifactWriter(),
  decorateEvent,
  correlation,
  env = process.env,
  now = () => new Date(),
  randomSuffix = () => randomUUID(),
}: CaptureFailureEventInput): Promise<CapturedFailureEvent | null> {
  if (config.mode === 'off') {
    return null;
  }

  const occurredAt = now();
  const suggestions = generateRankedLocatorSuggestions({
    actionType: action.type,
    failedTarget: action.target,
  });
  const runId = resolveRunId({
    correlationRunId: correlation?.runId,
    env,
  });
  const testId = resolveTestId({
    correlationTestId: correlation?.testId,
    env,
  });
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
    screenshotPath,
    action,
    error: normalizeError(error),
    suggestions,
  };

  if (decorateEvent) {
    await decorateEvent(event);
  }

  await writer(event);
  return event;
}
