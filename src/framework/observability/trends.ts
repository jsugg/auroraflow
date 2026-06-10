import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { AlertEvaluationResult } from './alertPolicies';
import { resolveRunId } from './correlation';
import type { FlakinessSummary } from './flakinessReport';
import type { SloDashboard } from './sloDashboard';

export const OBSERVABILITY_TREND_SCHEMA_VERSION = '1.0.0' as const;
export const DEFAULT_OBSERVABILITY_TREND_LIMIT = 100;
export const MAX_OBSERVABILITY_TREND_LIMIT = 10_000;

export type ObservabilityTrendSource = 'flakiness-report' | 'slo-dashboard' | 'slo-alerts';

export interface ObservabilityTrendTotals {
  sourceFiles: number;
  tests: number;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  skippedTests: number;
  interruptedTests: number;
  attempts: number;
  failedAttempts: number;
  retryAttempts: number;
}

export interface ObservabilityTrendRates {
  passRate: number | null;
  failureRate: number | null;
  flakeRate: number | null;
  retryFailureRate: number | null;
}

export interface ObservabilityTrendGuardedAutoHeal {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  successRate: number | null;
  failureRate: number | null;
}

export interface ObservabilityTrendGovernance {
  status: string | null;
  triageRequired: boolean;
  pendingPromotionCount: number;
  guardedAcceptedCount: number;
  registryPersistenceFailureCount: number;
}

export interface ObservabilityTrendSlo {
  overallStatus: SloDashboard['overallStatus'] | null;
  alertBreachCount: number;
  blockingAlertBreachCount: number;
}

export interface ObservabilityTrendPoint {
  schemaVersion: typeof OBSERVABILITY_TREND_SCHEMA_VERSION;
  generatedAt: string;
  source: ObservabilityTrendSource;
  runId: string;
  branch: string;
  commit: string;
  workflow: string;
  project: string;
  status: FlakinessSummary['status'];
  totals: ObservabilityTrendTotals;
  rates: ObservabilityTrendRates;
  guardedAutoHeal: ObservabilityTrendGuardedAutoHeal;
  governance: ObservabilityTrendGovernance;
  slo: ObservabilityTrendSlo;
}

export interface ObservabilityTrendMetadataInput {
  generatedAt?: Date | string;
  source: ObservabilityTrendSource;
  runId?: string;
  branch?: string;
  commit?: string;
  workflow?: string;
  project?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ObservabilityTrendWriteResult {
  filePath: string;
  limit: number;
  points: number;
  appended: ObservabilityTrendPoint;
}

export class ObservabilityTrendPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ObservabilityTrendPersistenceError';
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRequiredText(value: string | undefined, fallback: string): string {
  return normalizeOptionalText(value) ?? fallback;
}

function normalizeBranch(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.replace(/^refs\/heads\//u, '').replace(/^refs\/pull\//u, 'pull/');
}

function toIsoTimestamp(value: Date | string | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ObservabilityTrendPersistenceError('Trend generatedAt must be a valid date.');
    }
    return value.toISOString();
  }
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return new Date().toISOString();
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw new ObservabilityTrendPersistenceError('Trend generatedAt must be an ISO date-time.');
  }
  return new Date(parsed).toISOString();
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function buildMetadata({
  env = process.env,
  generatedAt,
  source,
  runId,
  branch,
  commit,
  workflow,
  project,
}: ObservabilityTrendMetadataInput): Pick<
  ObservabilityTrendPoint,
  'branch' | 'commit' | 'generatedAt' | 'project' | 'runId' | 'source' | 'workflow'
> {
  return {
    generatedAt: toIsoTimestamp(generatedAt),
    source,
    runId: resolveRunId({ runId, env }),
    branch: normalizeRequiredText(
      normalizeBranch(branch) ??
        normalizeBranch(env.AURORAFLOW_BRANCH) ??
        normalizeBranch(env.GITHUB_HEAD_REF) ??
        normalizeBranch(env.GITHUB_REF_NAME) ??
        normalizeBranch(env.GITHUB_REF),
      'local',
    ),
    commit: normalizeRequiredText(commit ?? env.AURORAFLOW_COMMIT ?? env.GITHUB_SHA, 'local'),
    workflow: normalizeRequiredText(
      workflow ?? env.AURORAFLOW_WORKFLOW ?? env.GITHUB_WORKFLOW,
      'local',
    ),
    project: normalizeRequiredText(
      project ?? env.AURORAFLOW_PROJECT ?? env.npm_package_name,
      'auroraflow',
    ),
  };
}

function buildRates(totals: ObservabilityTrendTotals): ObservabilityTrendRates {
  return {
    passRate: ratio(totals.passedTests, totals.tests),
    failureRate: ratio(totals.failedTests, totals.tests),
    flakeRate: ratio(totals.flakyTests, totals.tests),
    retryFailureRate: ratio(totals.failedAttempts, totals.attempts),
  };
}

function buildEmptyGuardedAutoHeal(): ObservabilityTrendGuardedAutoHeal {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    successRate: null,
    failureRate: null,
  };
}

function buildGuardedAutoHeal({
  attempted,
  succeeded,
  failed,
  skipped,
}: {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}): ObservabilityTrendGuardedAutoHeal {
  const normalizedAttempted = nonNegativeInteger(attempted);
  const normalizedSucceeded = nonNegativeInteger(succeeded);
  const normalizedFailed = nonNegativeInteger(failed);

  return {
    attempted: normalizedAttempted,
    succeeded: normalizedSucceeded,
    failed: normalizedFailed,
    skipped: nonNegativeInteger(skipped),
    successRate: ratio(normalizedSucceeded, normalizedAttempted),
    failureRate: ratio(normalizedFailed, normalizedAttempted),
  };
}

function emptyGovernance(): ObservabilityTrendGovernance {
  return {
    status: null,
    triageRequired: false,
    pendingPromotionCount: 0,
    guardedAcceptedCount: 0,
    registryPersistenceFailureCount: 0,
  };
}

function emptySlo(): ObservabilityTrendSlo {
  return {
    overallStatus: null,
    alertBreachCount: 0,
    blockingAlertBreachCount: 0,
  };
}

function buildFlakinessTotals(summary: FlakinessSummary): ObservabilityTrendTotals {
  return {
    sourceFiles: nonNegativeInteger(summary.sourceFiles),
    tests: nonNegativeInteger(summary.totalTests),
    passedTests: nonNegativeInteger(summary.passedTests),
    failedTests: nonNegativeInteger(summary.failedTests),
    flakyTests: nonNegativeInteger(summary.flakyTests),
    skippedTests: nonNegativeInteger(summary.skippedTests),
    interruptedTests: nonNegativeInteger(summary.interruptedTests),
    attempts: nonNegativeInteger(summary.totalAttempts),
    failedAttempts: nonNegativeInteger(summary.totalFailedAttempts),
    retryAttempts: nonNegativeInteger(summary.totalAttempts - summary.totalTests),
  };
}

function buildDashboardTotals(dashboard: SloDashboard): ObservabilityTrendTotals {
  return {
    sourceFiles: nonNegativeInteger(dashboard.sourceFiles),
    tests: nonNegativeInteger(dashboard.totals.tests),
    passedTests: nonNegativeInteger(dashboard.totals.passedTests),
    failedTests: nonNegativeInteger(dashboard.totals.failedTests),
    flakyTests: nonNegativeInteger(dashboard.totals.flakyTests),
    skippedTests: 0,
    interruptedTests: 0,
    attempts: nonNegativeInteger(dashboard.totals.attempts),
    failedAttempts: nonNegativeInteger(dashboard.totals.failedAttempts),
    retryAttempts: nonNegativeInteger(dashboard.totals.attempts - dashboard.totals.tests),
  };
}

export function buildObservabilityTrendPointFromFlakinessSummary({
  summary,
  metadata,
}: {
  summary: FlakinessSummary;
  metadata?: Omit<ObservabilityTrendMetadataInput, 'generatedAt' | 'source'> &
    Partial<Pick<ObservabilityTrendMetadataInput, 'generatedAt' | 'source'>>;
}): ObservabilityTrendPoint {
  const totals = buildFlakinessTotals(summary);
  return {
    schemaVersion: OBSERVABILITY_TREND_SCHEMA_VERSION,
    ...buildMetadata({
      ...metadata,
      generatedAt: metadata?.generatedAt ?? summary.generatedAt,
      source: metadata?.source ?? 'flakiness-report',
    }),
    status: summary.status,
    totals,
    rates: buildRates(totals),
    guardedAutoHeal: buildEmptyGuardedAutoHeal(),
    governance: emptyGovernance(),
    slo: emptySlo(),
  };
}

export function buildObservabilityTrendPointFromSloDashboard({
  dashboard,
  alertEvaluation,
  metadata,
}: {
  dashboard: SloDashboard;
  alertEvaluation?: AlertEvaluationResult;
  metadata?: Omit<ObservabilityTrendMetadataInput, 'generatedAt' | 'source'> &
    Partial<Pick<ObservabilityTrendMetadataInput, 'generatedAt' | 'source'>>;
}): ObservabilityTrendPoint {
  const totals = buildDashboardTotals(dashboard);
  return {
    schemaVersion: OBSERVABILITY_TREND_SCHEMA_VERSION,
    ...buildMetadata({
      ...metadata,
      generatedAt: metadata?.generatedAt ?? alertEvaluation?.generatedAt ?? dashboard.generatedAt,
      source: metadata?.source ?? 'slo-dashboard',
    }),
    status: dashboard.status,
    totals,
    rates: buildRates(totals),
    guardedAutoHeal: buildGuardedAutoHeal({
      attempted: dashboard.selfHealing.guardedAutoHealAttempts,
      succeeded: dashboard.selfHealing.guardedAutoHealSucceeded,
      failed: dashboard.selfHealing.guardedAutoHealFailed,
      skipped: dashboard.selfHealing.guardedAutoHealSkipped,
    }),
    governance: {
      status: dashboard.selfHealing.governanceStatus ?? null,
      triageRequired: dashboard.selfHealing.triageRequired,
      pendingPromotionCount: nonNegativeInteger(dashboard.selfHealing.pendingPromotionCount),
      guardedAcceptedCount: nonNegativeInteger(dashboard.selfHealing.guardedAcceptedCount),
      registryPersistenceFailureCount: nonNegativeInteger(
        dashboard.selfHealing.registryPersistenceFailureCount,
      ),
    },
    slo: {
      overallStatus: dashboard.overallStatus,
      alertBreachCount: nonNegativeInteger(alertEvaluation?.breachCount ?? 0),
      blockingAlertBreachCount: nonNegativeInteger(alertEvaluation?.blockingBreachCount ?? 0),
    },
  };
}

export function resolveTrendOutputPath({
  value,
  env = process.env,
}: {
  value?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string | undefined {
  return normalizeOptionalText(value) ?? normalizeOptionalText(env.AURORAFLOW_TREND_OUTPUT);
}

export function resolveTrendLimit({
  value,
  env = process.env,
}: {
  value?: string | number;
  env?: NodeJS.ProcessEnv;
} = {}): number {
  const rawValue = value ?? env.AURORAFLOW_TREND_LIMIT;
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return DEFAULT_OBSERVABILITY_TREND_LIMIT;
  }
  const parsed = typeof rawValue === 'number' ? rawValue : Number(String(rawValue));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_OBSERVABILITY_TREND_LIMIT) {
    throw new ObservabilityTrendPersistenceError(
      `Trend limit must be an integer between 1 and ${MAX_OBSERVABILITY_TREND_LIMIT}.`,
    );
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}

function readNullableRatio(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error(`${key} must be a ratio or null`);
  }
  return value;
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}

function parseTrendTotals(record: Record<string, unknown>): ObservabilityTrendTotals {
  return {
    sourceFiles: readInteger(record, 'sourceFiles'),
    tests: readInteger(record, 'tests'),
    passedTests: readInteger(record, 'passedTests'),
    failedTests: readInteger(record, 'failedTests'),
    flakyTests: readInteger(record, 'flakyTests'),
    skippedTests: readInteger(record, 'skippedTests'),
    interruptedTests: readInteger(record, 'interruptedTests'),
    attempts: readInteger(record, 'attempts'),
    failedAttempts: readInteger(record, 'failedAttempts'),
    retryAttempts: readInteger(record, 'retryAttempts'),
  };
}

function parseTrendRates(record: Record<string, unknown>): ObservabilityTrendRates {
  return {
    passRate: readNullableRatio(record, 'passRate'),
    failureRate: readNullableRatio(record, 'failureRate'),
    flakeRate: readNullableRatio(record, 'flakeRate'),
    retryFailureRate: readNullableRatio(record, 'retryFailureRate'),
  };
}

function parseGuardedAutoHeal(record: Record<string, unknown>): ObservabilityTrendGuardedAutoHeal {
  return {
    attempted: readInteger(record, 'attempted'),
    succeeded: readInteger(record, 'succeeded'),
    failed: readInteger(record, 'failed'),
    skipped: readInteger(record, 'skipped'),
    successRate: readNullableRatio(record, 'successRate'),
    failureRate: readNullableRatio(record, 'failureRate'),
  };
}

function parseGovernance(record: Record<string, unknown>): ObservabilityTrendGovernance {
  return {
    status: readNullableString(record, 'status'),
    triageRequired: readBoolean(record, 'triageRequired'),
    pendingPromotionCount: readInteger(record, 'pendingPromotionCount'),
    guardedAcceptedCount: readInteger(record, 'guardedAcceptedCount'),
    registryPersistenceFailureCount: readInteger(record, 'registryPersistenceFailureCount'),
  };
}

function parseSlo(record: Record<string, unknown>): ObservabilityTrendSlo {
  const overallStatus = record.overallStatus;
  if (
    overallStatus !== null &&
    overallStatus !== 'healthy' &&
    overallStatus !== 'degraded' &&
    overallStatus !== 'insufficient_data'
  ) {
    throw new Error('overallStatus must be a supported SLO status or null');
  }
  return {
    overallStatus,
    alertBreachCount: readInteger(record, 'alertBreachCount'),
    blockingAlertBreachCount: readInteger(record, 'blockingAlertBreachCount'),
  };
}

export function parseObservabilityTrendPoint(
  value: unknown,
  artifactLabel = 'observability trend point',
): ObservabilityTrendPoint {
  if (!isRecord(value)) {
    throw new ObservabilityTrendPersistenceError(`${artifactLabel} must be an object.`);
  }
  if (value.schemaVersion !== OBSERVABILITY_TREND_SCHEMA_VERSION) {
    throw new ObservabilityTrendPersistenceError(
      `${artifactLabel} schemaVersion must be ${OBSERVABILITY_TREND_SCHEMA_VERSION}.`,
    );
  }
  const source = value.source;
  if (source !== 'flakiness-report' && source !== 'slo-dashboard' && source !== 'slo-alerts') {
    throw new ObservabilityTrendPersistenceError(`${artifactLabel} source is not supported.`);
  }
  const status = value.status;
  if (status !== 'complete' && status !== 'no-input') {
    throw new ObservabilityTrendPersistenceError(`${artifactLabel} status is not supported.`);
  }

  try {
    return {
      schemaVersion: OBSERVABILITY_TREND_SCHEMA_VERSION,
      generatedAt: toIsoTimestamp(readString(value, 'generatedAt')),
      source,
      runId: readString(value, 'runId'),
      branch: readString(value, 'branch'),
      commit: readString(value, 'commit'),
      workflow: readString(value, 'workflow'),
      project: readString(value, 'project'),
      status,
      totals: parseTrendTotals(readRecord(value, 'totals')),
      rates: parseTrendRates(readRecord(value, 'rates')),
      guardedAutoHeal: parseGuardedAutoHeal(readRecord(value, 'guardedAutoHeal')),
      governance: parseGovernance(readRecord(value, 'governance')),
      slo: parseSlo(readRecord(value, 'slo')),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ObservabilityTrendPersistenceError(`${artifactLabel} is invalid: ${message}.`);
  }
}

function compareTrendPoints(left: ObservabilityTrendPoint, right: ObservabilityTrendPoint): number {
  const timestampDelta = Date.parse(left.generatedAt) - Date.parse(right.generatedAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return (
    [
      left.workflow.localeCompare(right.workflow),
      left.branch.localeCompare(right.branch),
      left.runId.localeCompare(right.runId),
      left.source.localeCompare(right.source),
      left.project.localeCompare(right.project),
    ].find((delta) => delta !== 0) ?? 0
  );
}

function toNodeError(error: unknown): NodeJS.ErrnoException | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException) : undefined;
}

export async function readObservabilityTrendPoints(
  filePath: string,
): Promise<ObservabilityTrendPoint[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (toNodeError(error)?.code === 'ENOENT') {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ObservabilityTrendPersistenceError(
      `Failed to read observability trend file ${filePath}: ${message}`,
    );
  }

  const points: ObservabilityTrendPoint[] = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) {
      continue;
    }
    try {
      points.push(
        parseObservabilityTrendPoint(JSON.parse(line) as unknown, `${filePath} line ${index + 1}`),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ObservabilityTrendPersistenceError(
        `Invalid observability trend file ${filePath} line ${index + 1}: ${message}`,
      );
    }
  }

  return [...points].sort(compareTrendPoints);
}

async function writeTrendPointsAtomically({
  filePath,
  points,
}: {
  filePath: string;
  points: readonly ObservabilityTrendPoint[];
}): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const payload = `${points.map((point) => JSON.stringify(point)).join('\n')}\n`;

  try {
    await writeFile(temporaryPath, payload, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new ObservabilityTrendPersistenceError(
      `Failed to write observability trend file ${filePath}: ${message}`,
    );
  }
}

export async function appendObservabilityTrendPoint({
  filePath,
  point,
  limit = DEFAULT_OBSERVABILITY_TREND_LIMIT,
}: {
  filePath: string;
  point: ObservabilityTrendPoint;
  limit?: number;
}): Promise<ObservabilityTrendWriteResult> {
  const boundedLimit = resolveTrendLimit({ value: limit });
  const existing = await readObservabilityTrendPoints(filePath);
  const points = [...existing, parseObservabilityTrendPoint(point)]
    .sort(compareTrendPoints)
    .slice(-boundedLimit);

  await writeTrendPointsAtomically({ filePath, points });
  return {
    filePath,
    limit: boundedLimit,
    points: points.length,
    appended: point,
  };
}
