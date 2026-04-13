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
  const event: CapturedFailureEvent = {
    artifactVersion: '1.0.0',
    eventId: buildEventId(occurredAt, randomSuffix()),
    timestamp: occurredAt.toISOString(),
    mode: config.mode,
    minConfidence: config.minConfidence,
    pageObjectName,
    currentUrl,
    screenshotPath,
    action,
    error: normalizeError(error),
    suggestions,
  };

  await writer(event);
  return event;
}
