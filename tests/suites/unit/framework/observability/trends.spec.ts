import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMA_FILES,
  validateGeneratedArtifacts,
} from '../../../../../scripts/schemas-check';
import {
  evaluateAlertPolicy,
  parseAlertPolicy,
} from '../../../../../src/framework/observability/alertPolicies';
import {
  buildFlakinessSummary,
  type FlakinessSummary,
  type FlakinessTestCase,
} from '../../../../../src/framework/observability/flakinessReport';
import {
  buildSloDashboard,
  type SelfHealingGovernanceSummary,
} from '../../../../../src/framework/observability/sloDashboard';
import {
  ObservabilityTrendPersistenceError,
  appendObservabilityTrendPoint,
  buildObservabilityTrendPointFromFlakinessSummary,
  buildObservabilityTrendPointFromSloDashboard,
  readObservabilityTrendPoints,
  resolveTrendLimit,
  resolveTrendOutputPath,
} from '../../../../../src/framework/observability/trends';

const trendEnv = {
  AURORAFLOW_RUN_ID: 'run-123',
  GITHUB_REF_NAME: 'feature/trends',
  GITHUB_SHA: 'abc123',
  GITHUB_WORKFLOW: 'Quality',
  AURORAFLOW_PROJECT: 'auroraflow-tests',
} satisfies NodeJS.ProcessEnv;
const SCHEMA_TEST_TIMEOUT_MS = 15_000;

let temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories = [];
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'auroraflow-trends-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createCase(overrides: Partial<FlakinessTestCase> = {}): FlakinessTestCase {
  return {
    caseId: 'tests/example.spec.ts:10:1:Google Chrome',
    projectName: 'Google Chrome',
    file: 'tests/example.spec.ts',
    line: 10,
    column: 1,
    titlePath: ['example', 'passes after retry'],
    fullTitle: 'example > passes after retry',
    attempts: 2,
    retriesUsed: 1,
    failedAttempts: 1,
    durationMs: 50,
    finalStatus: 'passed',
    flaky: true,
    ...overrides,
  };
}

function createSummary(generatedAt = '2026-06-05T12:00:00.000Z'): FlakinessSummary {
  return buildFlakinessSummary({
    sourceFiles: 1,
    generatedAt: new Date(generatedAt),
    cases: [
      createCase(),
      createCase({
        caseId: 'tests/example.spec.ts:20:1:Google Chrome',
        line: 20,
        attempts: 1,
        retriesUsed: 0,
        failedAttempts: 1,
        finalStatus: 'failed',
        flaky: false,
      }),
    ],
  });
}

function createGovernanceSummary(): SelfHealingGovernanceSummary {
  return {
    status: 'triage_required',
    triageRequired: true,
    guardedAcceptedCount: 2,
    pendingPromotionCount: 1,
    registryPersistenceFailureCount: 1,
    telemetry: {
      guardedAutoHeal: {
        attempted: 4,
        succeeded: 3,
        failed: 1,
        skipped: 2,
      },
    },
  };
}

describe('observability trends', () => {
  it('builds deterministic flakiness trend points from summaries and runtime metadata', () => {
    const point = buildObservabilityTrendPointFromFlakinessSummary({
      summary: createSummary(),
      metadata: { env: trendEnv },
    });

    expect(point).toMatchObject({
      schemaVersion: '1.0.0',
      generatedAt: '2026-06-05T12:00:00.000Z',
      source: 'flakiness-report',
      runId: 'run-123',
      branch: 'feature/trends',
      commit: 'abc123',
      workflow: 'Quality',
      project: 'auroraflow-tests',
      totals: {
        tests: 2,
        passedTests: 1,
        failedTests: 1,
        flakyTests: 1,
        attempts: 3,
        failedAttempts: 2,
        retryAttempts: 1,
      },
      rates: {
        passRate: 0.5,
        failureRate: 0.5,
        flakeRate: 0.5,
        retryFailureRate: 2 / 3,
      },
      governance: {
        status: null,
        pendingPromotionCount: 0,
      },
    });
  });

  it('builds SLO trend points with guarded auto-heal, governance, and alert counts', () => {
    const dashboard = buildSloDashboard({
      flakiness: createSummary(),
      governance: createGovernanceSummary(),
      generatedAt: new Date('2026-06-05T12:15:00.000Z'),
    });
    const alertEvaluation = evaluateAlertPolicy({
      dashboard,
      policy: parseAlertPolicy({
        version: '1.0.0',
        alerts: [
          {
            id: 'pass-rate-low',
            metric: 'passRate',
            operator: 'lt',
            threshold: 0.98,
            severity: 'warning',
            description: 'Pass rate below SLO.',
          },
        ],
      }),
      generatedAt: new Date('2026-06-05T12:20:00.000Z'),
    });

    const point = buildObservabilityTrendPointFromSloDashboard({
      dashboard,
      alertEvaluation,
      metadata: { env: trendEnv, source: 'slo-alerts' },
    });

    expect(point.source).toBe('slo-alerts');
    expect(point.generatedAt).toBe('2026-06-05T12:20:00.000Z');
    expect(point.guardedAutoHeal).toMatchObject({
      attempted: 4,
      succeeded: 3,
      failed: 1,
      skipped: 2,
      successRate: 0.75,
      failureRate: 0.25,
    });
    expect(point.governance).toEqual({
      status: 'triage_required',
      triageRequired: true,
      pendingPromotionCount: 1,
      guardedAcceptedCount: 2,
      registryPersistenceFailureCount: 1,
    });
    expect(point.slo).toEqual({
      overallStatus: 'degraded',
      alertBreachCount: 1,
      blockingAlertBreachCount: 0,
    });
  });

  it('appends trend JSONL atomically, sorted by timestamp and bounded by limit', async () => {
    const directory = await makeTemporaryDirectory();
    const trendPath = path.join(directory, 'observability-trends.jsonl');
    const first = buildObservabilityTrendPointFromFlakinessSummary({
      summary: createSummary('2026-06-05T12:00:00.000Z'),
      metadata: { env: trendEnv, runId: 'run-1' },
    });
    const second = buildObservabilityTrendPointFromFlakinessSummary({
      summary: createSummary('2026-06-05T12:02:00.000Z'),
      metadata: { env: trendEnv, runId: 'run-2' },
    });
    const third = buildObservabilityTrendPointFromFlakinessSummary({
      summary: createSummary('2026-06-05T12:01:00.000Z'),
      metadata: { env: trendEnv, runId: 'run-3' },
    });

    await appendObservabilityTrendPoint({ filePath: trendPath, point: first, limit: 2 });
    await appendObservabilityTrendPoint({ filePath: trendPath, point: second, limit: 2 });
    const result = await appendObservabilityTrendPoint({
      filePath: trendPath,
      point: third,
      limit: 2,
    });

    expect(result.points).toBe(2);
    await expect(readObservabilityTrendPoints(trendPath)).resolves.toEqual([third, second]);
  });

  it('skips malformed trend lines, preserves valid points, and reports warnings', async () => {
    const directory = await makeTemporaryDirectory();
    const trendPath = path.join(directory, 'observability-trends.jsonl');
    const first = buildObservabilityTrendPointFromFlakinessSummary({
      summary: createSummary('2026-06-05T12:00:00.000Z'),
      metadata: { env: trendEnv, runId: 'run-1' },
    });
    const second = buildObservabilityTrendPointFromFlakinessSummary({
      summary: createSummary('2026-06-05T12:02:00.000Z'),
      metadata: { env: trendEnv, runId: 'run-2' },
    });
    const warnings: Array<{ filePath: string; line: number; message: string }> = [];
    await writeFile(
      trendPath,
      `${JSON.stringify(first)}\nnot-json\n${JSON.stringify(second)}\n`,
      'utf8',
    );

    await expect(
      readObservabilityTrendPoints(trendPath, {
        onWarning: (warning) => warnings.push(warning),
      }),
    ).resolves.toEqual([first, second]);
    expect(warnings).toEqual([
      expect.objectContaining({
        filePath: trendPath,
        line: 2,
        message: expect.stringMatching(/Invalid observability trend file .* line 2/u),
      }),
    ]);

    const result = await appendObservabilityTrendPoint({
      filePath: trendPath,
      point: buildObservabilityTrendPointFromFlakinessSummary({
        summary: createSummary('2026-06-05T12:03:00.000Z'),
        metadata: { env: trendEnv, runId: 'run-3' },
      }),
    });

    expect(result.skippedLines).toBe(1);
    await expect(readObservabilityTrendPoints(trendPath)).resolves.toHaveLength(3);
  });

  it('retains opt-in strict parsing for corruption diagnostics', async () => {
    const directory = await makeTemporaryDirectory();
    const trendPath = path.join(directory, 'observability-trends.jsonl');
    await writeFile(trendPath, 'not-json\n', 'utf8');

    await expect(readObservabilityTrendPoints(trendPath, { strict: true })).rejects.toThrow(
      ObservabilityTrendPersistenceError,
    );
    await expect(readObservabilityTrendPoints(trendPath, { strict: true })).rejects.toThrow(
      /Invalid observability trend file .* line 1/u,
    );
  });

  it('resolves optional trend CLI and environment settings', () => {
    expect(resolveTrendOutputPath({ env: { AURORAFLOW_TREND_OUTPUT: 'trend.jsonl' } })).toBe(
      'trend.jsonl',
    );
    expect(resolveTrendOutputPath({ value: 'cli.jsonl', env: trendEnv })).toBe('cli.jsonl');
    expect(resolveTrendLimit({ value: '25', env: trendEnv })).toBe(25);
    expect(() => resolveTrendLimit({ value: '0', env: trendEnv })).toThrow(
      ObservabilityTrendPersistenceError,
    );
  });

  it(
    'validates generated JSONL trend files through schema checks',
    async () => {
      const directory = await makeTemporaryDirectory();
      const trendPath = path.join(directory, '.auroraflow-trends', 'slo-trends.jsonl');
      await appendObservabilityTrendPoint({
        filePath: trendPath,
        point: buildObservabilityTrendPointFromFlakinessSummary({
          summary: createSummary(),
          metadata: { env: trendEnv },
        }),
      });

      const summary = await validateGeneratedArtifacts({ artifactsRoot: directory });

      expect(summary.validatedArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactPath: trendPath,
            schemaFile: ARTIFACT_SCHEMA_FILES.observabilityTrendPoint,
            format: 'jsonl',
          }),
        ]),
      );
    },
    SCHEMA_TEST_TIMEOUT_MS,
  );
});
