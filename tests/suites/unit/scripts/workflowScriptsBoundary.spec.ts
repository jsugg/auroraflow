import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AlertPolicy } from '../../../../src/framework/observability/alertPolicies';
import type { FlakinessSummary } from '../../../../src/framework/observability/flakinessReport';
import type { SloDashboard } from '../../../../src/framework/observability/sloDashboard';

const REPO_ROOT = process.cwd();
const PROCESS_TIMEOUT_MS = 60_000;
// Each test's success/failure children run concurrently, so the test budget only needs to
// clear a single process timeout with margin — large enough that the per-process
// `formatTimeoutDiagnostics` reject surfaces before the test-level timeout fires. Also
// reused as the warm-up hook budget.
const BOUNDARY_TEST_TIMEOUT_MS = PROCESS_TIMEOUT_MS + 30_000;
const REGISTER_TS_TRANSPILE = path.join(REPO_ROOT, 'tests/helpers/registerTsTranspile.cjs');
const TS_TRANSPILE_CACHE = mkdtempSync(path.join(os.tmpdir(), 'auroraflow-ts-transpile-cache-'));

interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const temporaryDirectories = new Set<string>();

function outputTail(output: string): string {
  return output.slice(-1_000);
}

interface TimeoutDiagnostics {
  readonly args: readonly string[];
  readonly startedAt: number;
  readonly firstOutputAt: number | null;
  readonly lastOutputAt: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// Build a timeout message that separates the failure modes a slow child can hit:
// cold-start/transpile cost (no output captured yet), an in-script hang (output then
// idle before the kill), and a near-complete-but-slow run. A bare "timed out" line
// cannot be triaged into startup vs. hang vs. assertion failure.
function formatTimeoutDiagnostics(diagnostics: TimeoutDiagnostics): string {
  const { args, startedAt, firstOutputAt, lastOutputAt, stdout, stderr } = diagnostics;
  const now = Date.now();
  const elapsedMs = now - startedAt;
  const command = `${process.execPath} ${args.join(' ')}`;
  const phase =
    firstOutputAt === null
      ? `no output captured in ${elapsedMs}ms — likely cold-start/transpile cost or a hang before first write`
      : `first output at ${firstOutputAt - startedAt}ms, last output at ${
          (lastOutputAt ?? firstOutputAt) - startedAt
        }ms, idle ${now - (lastOutputAt ?? firstOutputAt)}ms before kill — likely an in-script hang`;
  return [
    `Process timed out after ${elapsedMs}ms (limit ${PROCESS_TIMEOUT_MS}ms): ${command}`,
    `diagnosis: ${phase}`,
    `captured stdout bytes: ${stdout.length}, stderr bytes: ${stderr.length}`,
    `stdout tail: ${outputTail(stdout)}`,
    `stderr tail: ${outputTail(stderr)}`,
  ].join('\n');
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

afterAll(() => {
  rmSync(TS_TRANSPILE_CACHE, { recursive: true, force: true });
});

// Warm the shared TS transpile cache once before the boundary cases run. A single cold
// pass over the framework barrel transpiles the graph the scripts share, so each test's
// child pair starts warm and never triggers concurrent cold transpiles — the load-sensitive
// path that made this spec time out under full-suite contention (AUR-QE-115-2). This lets the
// success/failure pairs keep running concurrently without the timeout risk.
beforeAll(async () => {
  const warmUp = await runNode(['-r', REGISTER_TS_TRANSPILE, '-e', 'require("./src/index.ts")']);
  if (warmUp.status !== 0) {
    throw new Error(
      [
        `Failed to warm the TS transpile cache (exit ${warmUp.status ?? 'null'}).`,
        `stdout tail: ${outputTail(warmUp.stdout)}`,
        `stderr tail: ${outputTail(warmUp.stderr)}`,
      ].join('\n'),
    );
  }
}, BOUNDARY_TEST_TIMEOUT_MS);

function createTempDir(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function runNode(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        AURORAFLOW_TREND_OUTPUT: '',
        AURORAFLOW_TS_TRANSPILE_CACHE: TS_TRANSPILE_CACHE,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let firstOutputAt: number | null = null;
    let lastOutputAt: number | null = null;
    const markOutput = (): void => {
      const now = Date.now();
      firstOutputAt ??= now;
      lastOutputAt = now;
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          formatTimeoutDiagnostics({
            args,
            startedAt,
            firstOutputAt,
            lastOutputAt,
            stdout,
            stderr,
          }),
        ),
      );
    }, PROCESS_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      markOutput();
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      markOutput();
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timeout);
      if (signal !== null) {
        reject(
          new Error(`Process exited from signal ${signal}: ${process.execPath} ${args.join(' ')}`),
        );
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });
}

function runTypeScriptScript(
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<ProcessResult> {
  return runNode(['-r', REGISTER_TS_TRANSPILE, scriptPath, ...args], env);
}

function samplePlaywrightReport(): unknown {
  return {
    suites: [
      {
        title: '',
        suites: [
          {
            title: 'auth',
            specs: [
              {
                title: 'login succeeds',
                file: 'tests/suites/e2e/auth/login.spec.ts',
                line: 10,
                column: 3,
                tests: [
                  {
                    projectName: 'Google Chrome',
                    results: [
                      { duration: 15, status: 'failed' },
                      { duration: 20, status: 'passed' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function createFlakinessSummary(overrides: Partial<FlakinessSummary> = {}): FlakinessSummary {
  return {
    generatedAt: '2026-04-15T12:00:00.000Z',
    status: 'complete',
    sourceFiles: 1,
    totalTests: 100,
    flakyTests: 1,
    failedTests: 1,
    passedTests: 98,
    skippedTests: 0,
    interruptedTests: 0,
    totalAttempts: 104,
    totalFailedAttempts: 4,
    projectBreakdown: [],
    topFlakyCases: [],
    testCases: [],
    ...overrides,
  };
}

function createDashboard(overrides: Partial<SloDashboard> = {}): SloDashboard {
  return {
    generatedAt: '2026-04-15T12:30:00.000Z',
    status: 'complete',
    overallStatus: 'healthy',
    sourceFiles: 1,
    totals: {
      tests: 100,
      attempts: 104,
      failedAttempts: 4,
      passedTests: 98,
      failedTests: 1,
      flakyTests: 1,
    },
    selfHealing: {
      triageRequired: false,
      pendingPromotionCount: 0,
      guardedAcceptedCount: 0,
      registryPersistenceFailureCount: 0,
      guardedAutoHealAttempts: 10,
      guardedAutoHealSucceeded: 10,
      guardedAutoHealFailed: 0,
      guardedAutoHealSkipped: 0,
    },
    metrics: [
      {
        key: 'passRate',
        label: 'Pass Rate',
        value: 0.98,
        status: 'met',
        target: { comparator: 'gte', threshold: 0.98, rationale: 'pass rate target' },
      },
      {
        key: 'failureRate',
        label: 'Failure Rate',
        value: 0.01,
        status: 'met',
        target: { comparator: 'lte', threshold: 0.02, rationale: 'failure rate target' },
      },
      {
        key: 'flakeRate',
        label: 'Flake Rate',
        value: 0.01,
        status: 'met',
        target: { comparator: 'lte', threshold: 0.02, rationale: 'flake rate target' },
      },
      {
        key: 'retryFailureRate',
        label: 'Retry Failure Rate',
        value: 0.038,
        status: 'met',
        target: { comparator: 'lte', threshold: 0.1, rationale: 'retry failure target' },
      },
      {
        key: 'guardedAutoHealFailureRate',
        label: 'Guarded Auto-Heal Failure Rate',
        value: 0,
        status: 'met',
        target: {
          comparator: 'lte',
          threshold: 0.05,
          rationale: 'guarded auto-heal failure target',
        },
      },
    ],
    ...overrides,
  };
}

function createAlertPolicy(overrides: Partial<AlertPolicy> = {}): AlertPolicy {
  return {
    version: '1.0.0',
    alerts: [
      {
        id: 'flake-rate-high',
        metric: 'flakeRate',
        operator: 'gt',
        threshold: 0.02,
        severity: 'critical',
        description: 'Flake rate above threshold.',
      },
    ],
    ...overrides,
  };
}

describe('workflow script process boundaries', () => {
  it(
    'flakiness-report exits with actionable output for success and invalid arguments',
    async () => {
      const root = createTempDir('auroraflow-flakiness-boundary-');
      const inputDir = path.join(root, 'input');
      const outputJson = path.join(root, 'flakiness-summary.json');
      const outputMarkdown = path.join(root, 'flakiness-summary.md');
      writeJsonFile(path.join(inputDir, 'playwright-results-smoke.json'), samplePlaywrightReport());

      const [success, failure] = await Promise.all([
        runTypeScriptScript('scripts/flakiness-report.ts', [
          '--input-dir',
          inputDir,
          '--output-json',
          outputJson,
          '--output-md',
          outputMarkdown,
        ]),
        runTypeScriptScript('scripts/flakiness-report.ts', ['--top-limit', '0']),
      ]);

      expect(success.status).toBe(0);
      expect(success.stdout).toContain(
        'Flakiness report generated: status=complete sourceFiles=1 flakyTests=1 failedTests=0',
      );
      expect(success.stdout).toContain(`JSON summary: ${outputJson}`);
      expect(success.stderr).toBe('');
      expect(existsSync(outputJson)).toBe(true);

      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain(
        'Failed to generate flakiness report: --top-limit must be a positive integer.',
      );
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );

  it(
    'slo-dashboard exits with actionable output for success and invalid arguments',
    async () => {
      const root = createTempDir('auroraflow-slo-dashboard-boundary-');
      const flakinessJson = path.join(root, 'flakiness-summary.json');
      const outputJson = path.join(root, 'slo-dashboard.json');
      const outputMarkdown = path.join(root, 'slo-dashboard.md');
      writeJsonFile(flakinessJson, createFlakinessSummary());

      const [success, failure] = await Promise.all([
        runTypeScriptScript('scripts/slo-dashboard.ts', [
          '--flakiness-json',
          flakinessJson,
          '--output-json',
          outputJson,
          '--output-md',
          outputMarkdown,
        ]),
        runTypeScriptScript('scripts/slo-dashboard.ts', ['--flakiness-json']),
      ]);

      expect(success.status).toBe(0);
      expect(success.stdout).toContain(
        'SLO dashboard generated: overallStatus=healthy status=complete',
      );
      expect(success.stdout).toContain(`JSON summary: ${outputJson}`);
      expect(success.stderr).toBe('');

      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain(
        'Failed to generate SLO dashboard: Missing value for --flakiness-json.',
      );
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );

  it(
    'slo-alerts exits with actionable output for success and expected blocking breaches',
    async () => {
      const root = createTempDir('auroraflow-slo-alerts-boundary-');
      const successDashboardJson = path.join(root, 'success/slo-dashboard.json');
      const successPolicyJson = path.join(root, 'success/slo-policy.json');
      const successOutputJson = path.join(root, 'success/slo-alerts.json');
      const successOutputMarkdown = path.join(root, 'success/slo-alerts.md');
      const failureDashboardJson = path.join(root, 'failure/slo-dashboard.json');
      const failurePolicyJson = path.join(root, 'failure/slo-policy.json');
      const failureOutputJson = path.join(root, 'failure/slo-alerts.json');
      const failureOutputMarkdown = path.join(root, 'failure/slo-alerts.md');
      writeJsonFile(successDashboardJson, createDashboard());
      writeJsonFile(successPolicyJson, createAlertPolicy());
      writeJsonFile(
        failureDashboardJson,
        createDashboard({
          overallStatus: 'degraded',
          metrics: createDashboard().metrics.map((metric) =>
            metric.key === 'flakeRate' ? { ...metric, value: 0.08, status: 'breached' } : metric,
          ),
        }),
      );
      writeJsonFile(
        failurePolicyJson,
        createAlertPolicy({
          alerts: [{ ...createAlertPolicy().alerts[0]!, blockOnBreach: true }],
        }),
      );

      const [success, failure] = await Promise.all([
        runTypeScriptScript('scripts/slo-alerts.ts', [
          '--dashboard-json',
          successDashboardJson,
          '--policy-file',
          successPolicyJson,
          '--output-json',
          successOutputJson,
          '--output-md',
          successOutputMarkdown,
        ]),
        runTypeScriptScript('scripts/slo-alerts.ts', [
          '--dashboard-json',
          failureDashboardJson,
          '--policy-file',
          failurePolicyJson,
          '--output-json',
          failureOutputJson,
          '--output-md',
          failureOutputMarkdown,
        ]),
      ]);

      expect(success.status).toBe(0);
      expect(success.stdout).toContain('SLO alerts evaluated: breaches=0 blockingBreaches=0');
      expect(success.stdout).toContain(`JSON summary: ${successOutputJson}`);
      expect(success.stderr).toBe('');

      expect(failure.status).toBe(1);
      expect(failure.stdout).toContain('SLO alerts evaluated: breaches=1 blockingBreaches=1');
      expect(failure.stderr).toContain(
        'Blocking SLO breaches detected based on configured policy.',
      );
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );

  it(
    'schemas-check exits with actionable output for empty artifacts and invalid artifacts',
    async () => {
      const root = createTempDir('auroraflow-schemas-boundary-');
      const successRoot = path.join(root, 'success');
      mkdirSync(successRoot, { recursive: true });
      const failureRoot = path.join(root, 'failure');
      writeJsonFile(path.join(failureRoot, 'test-results/flakiness-summary.json'), {
        status: 'complete',
      });

      const [success, failure] = await Promise.all([
        runTypeScriptScript('scripts/schemas-check.ts', ['--artifacts-root', successRoot]),
        runTypeScriptScript('scripts/schemas-check.ts', ['--artifacts-root', failureRoot]),
      ]);

      expect(success.status).toBe(0);
      expect(success.stdout).toContain('Compiled ');
      expect(success.stdout).toContain(
        'No generated JSON artifacts found under test-results; schema compile check passed.',
      );
      expect(success.stderr).toBe('');

      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain('Schema validation failed:');
      expect(failure.stderr).toContain('flakiness-summary.json does not match');
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );

  it(
    'self-healing governance exits with actionable output for pass and review-required failure',
    async () => {
      const root = createTempDir('auroraflow-governance-boundary-');
      const successSummaryJson = path.join(root, 'success/summary.json');
      const successSummaryMarkdown = path.join(root, 'success/summary.md');
      const failureArtifactsDir = path.join(root, 'failure/artifacts');
      const failureSummaryJson = path.join(root, 'failure/summary.json');
      const failureSummaryMarkdown = path.join(root, 'failure/summary.md');

      writeJsonFile(path.join(failureArtifactsDir, 'event-001.json'), {
        eventId: 'evt-001',
        mode: 'guarded',
        pageObjectName: 'CheckoutPage',
        action: { type: 'click' },
        guardedAutoHeal: {
          attempted: true,
          succeeded: true,
        },
        guardedValidation: {
          acceptedLocator: '#submit-primary',
          acceptedScore: 0.96,
        },
      });

      const [success, failure] = await Promise.all([
        runNode(['scripts/self-healing-governance.mjs'], {
          SELF_HEAL_ARTIFACTS_DIR: path.join(root, 'missing-artifacts'),
          SELF_HEAL_GOVERNANCE_SUMMARY_JSON: successSummaryJson,
          SELF_HEAL_GOVERNANCE_SUMMARY_MD: successSummaryMarkdown,
        }),
        runNode(['scripts/self-healing-governance.mjs'], {
          SELF_HEAL_ARTIFACTS_DIR: failureArtifactsDir,
          SELF_HEAL_GOVERNANCE_SUMMARY_JSON: failureSummaryJson,
          SELF_HEAL_GOVERNANCE_SUMMARY_MD: failureSummaryMarkdown,
        }),
      ]);

      expect(success.status).toBe(0);
      expect(success.stdout).toContain('Self-healing governance status=pass');
      expect(success.stdout).toContain(`Governance JSON summary: ${successSummaryJson}`);
      expect(success.stderr).toBe('');

      expect(failure.status).toBe(1);
      expect(failure.stdout).toContain(
        'Self-healing governance status=blocked_acknowledgement_required',
      );
      expect(failure.stderr).toContain(
        'Guarded accepted self-healing candidates detected. Set SELF_HEAL_ACKNOWLEDGED=true after review.',
      );
      expect(readFileSync(failureSummaryJson, 'utf8')).toContain(
        'blocked_acknowledgement_required',
      );
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );

  it(
    'self-healing promotions exits with actionable output for memory-backed list and bad command',
    async () => {
      const [success, failure] = await Promise.all([
        runTypeScriptScript(
          'scripts/self-healing-promotions.ts',
          ['list', '--namespace', 'process-boundary', '--limit', '5'],
          { AURORAFLOW_SELF_HEALING_SCRIPT_STORE: 'memory' },
        ),
        runTypeScriptScript('scripts/self-healing-promotions.ts', ['unknown']),
      ]);

      expect(success.status).toBe(0);
      expect(JSON.parse(success.stdout) as unknown).toMatchObject({
        promotions: [],
        statusCounts: {},
      });
      expect(success.stderr).toBe('');

      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain(
        'Usage: self-healing-promotions <list|approve|reject|rollback|cleanup> [--flag value]',
      );
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );

  it(
    'self-healing registry cleanup exits with actionable output for memory cleanup and bad limit',
    async () => {
      const [success, failure] = await Promise.all([
        runTypeScriptScript('scripts/self-healing-registry-cleanup.ts', [], {
          AURORAFLOW_SELF_HEALING_SCRIPT_STORE: 'memory',
          SELF_HEAL_REGISTRY_NAMESPACE: 'process-boundary',
        }),
        runTypeScriptScript('scripts/self-healing-registry-cleanup.ts', [], {
          AURORAFLOW_SELF_HEALING_SCRIPT_STORE: 'memory',
          SELF_HEAL_REGISTRY_CLEANUP_LIMIT: '0',
        }),
      ]);

      expect(success.status).toBe(0);
      expect(JSON.parse(success.stdout) as unknown).toMatchObject({
        historyScanned: 0,
        historyDeleted: 0,
        promotionsScanned: 0,
        promotionsDeleted: 0,
        malformedRecords: 0,
      });
      expect(success.stderr).toBe('');

      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain(
        'SELF_HEAL_REGISTRY_CLEANUP_LIMIT must be a positive integer.',
      );
    },
    BOUNDARY_TEST_TIMEOUT_MS,
  );
});
