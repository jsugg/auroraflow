import type { TestInfo } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const SELF_HEALING_ARTIFACT_ENV_KEYS = [
  'AURORAFLOW_RUN_ID',
  'AURORAFLOW_TEST_ID',
  'SELF_HEAL_ARTIFACTS_DIR',
] as const;

export type SelfHealingArtifactEnvKey = (typeof SELF_HEALING_ARTIFACT_ENV_KEYS)[number];

export interface SelfHealingArtifactScope {
  readonly artifactsDir: string;
  readonly env: Readonly<Record<SelfHealingArtifactEnvKey, string>>;
  readonly runId: string;
  readonly testId: string;
}

interface SelfHealingArtifactIdentity {
  readonly runId?: string;
  readonly testId?: string;
}

interface SelfHealingArtifactScopeOptions {
  readonly artifactsDir?: string;
  readonly prefix?: string;
  readonly runId?: string;
  readonly testId?: string;
}

interface ReadSelfHealingArtifactOptions {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
}

function sanitizeIdentifier(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
}

function buildScope({
  artifactsDir,
  fallbackSlug,
  runId,
  testId,
}: {
  artifactsDir: string;
  fallbackSlug: string;
  runId?: string;
  testId?: string;
}): SelfHealingArtifactScope {
  const normalizedTestId = sanitizeIdentifier(testId ?? fallbackSlug) || 'self-healing-test';
  const normalizedRunId =
    sanitizeIdentifier(runId ?? `self-healing-${normalizedTestId}`) || 'self-healing-run';

  return {
    artifactsDir,
    env: {
      AURORAFLOW_RUN_ID: normalizedRunId,
      AURORAFLOW_TEST_ID: normalizedTestId,
      SELF_HEAL_ARTIFACTS_DIR: artifactsDir,
    },
    runId: normalizedRunId,
    testId: normalizedTestId,
  };
}

/** Creates a Playwright-owned artifact scope under `testInfo.outputPath()`. */
export async function createPlaywrightSelfHealingArtifactScope(
  testInfo: TestInfo,
  options: SelfHealingArtifactScopeOptions = {},
): Promise<SelfHealingArtifactScope> {
  const prefix = sanitizeIdentifier(options.prefix ?? 'self-healing') || 'self-healing';
  const fallbackSlug = sanitizeIdentifier(`${testInfo.testId}-retry-${testInfo.retry}`) || prefix;
  const artifactsDir = options.artifactsDir ?? testInfo.outputPath(`${prefix}-artifacts`);

  await mkdir(artifactsDir, { recursive: true });

  return buildScope({
    artifactsDir,
    fallbackSlug,
    runId: options.runId,
    testId: options.testId,
  });
}

/** Creates a Vitest artifact scope in a unique temporary directory. */
export async function createVitestSelfHealingArtifactScope(
  options: SelfHealingArtifactScopeOptions = {},
): Promise<SelfHealingArtifactScope> {
  const prefix = sanitizeIdentifier(options.prefix ?? 'auroraflow-self-healing') || 'auroraflow';
  const artifactsDir = options.artifactsDir ?? (await mkdtemp(path.join(tmpdir(), `${prefix}-`)));

  await mkdir(artifactsDir, { recursive: true });

  return buildScope({
    artifactsDir,
    fallbackSlug: sanitizeIdentifier(path.basename(artifactsDir)) || prefix,
    runId: options.runId,
    testId: options.testId,
  });
}

export function applySelfHealingArtifactScopeEnv(scope: SelfHealingArtifactScope): void {
  for (const key of SELF_HEALING_ARTIFACT_ENV_KEYS) {
    process.env[key] = scope.env[key];
  }
}

export async function cleanupSelfHealingArtifactScope(
  scope: SelfHealingArtifactScope | undefined,
): Promise<void> {
  if (scope === undefined) {
    return;
  }
  await rm(scope.artifactsDir, { recursive: true, force: true });
}

export async function readSelfHealingArtifacts<T>(scope: SelfHealingArtifactScope): Promise<T[]> {
  const files = await readdir(scope.artifactsDir).catch(() => []);
  const artifacts: T[] = [];

  for (const file of [...files].sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }
    artifacts.push(JSON.parse(await readFile(path.join(scope.artifactsDir, file), 'utf8')) as T);
  }

  return artifacts;
}

export async function readSelfHealingArtifactFor<T>(
  scope: SelfHealingArtifactScope,
  options: ReadSelfHealingArtifactOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let matchCount = 0;

  do {
    const artifacts = await readSelfHealingArtifacts<T & SelfHealingArtifactIdentity>(scope);
    const matches = artifacts.filter(
      (artifact) => artifact.runId === scope.runId && artifact.testId === scope.testId,
    );

    if (matches.length === 1) {
      return matches[0];
    }
    matchCount = matches.length;
    if (matches.length > 1) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() < deadline);

  throw new Error(
    `Expected one self-healing artifact for ${scope.runId}/${scope.testId} under ${scope.artifactsDir}; found ${matchCount}.`,
  );
}
