import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SPAN_NAMES } from '../src/framework/observability/attributes';
import { METRIC_NAMES } from '../src/framework/observability/metricNames';
import {
  initializeTelemetry,
  shutdownTelemetry,
  type TelemetryDiagnosticLogger,
} from '../src/framework/observability/telemetry';

interface DiagnosticEvent {
  readonly level: 'error' | 'warn';
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const DEFAULT_COLLECTOR_ENDPOINT = 'http://localhost:4318';
const DEFAULT_DIAGNOSTICS_DIR = path.join('observability-output', 'ci');
const LOG_PATH = path.join('logs', 'auroraflow.ndjson');

function buildTelemetryEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    AURORAFLOW_OBSERVABILITY_ENABLED: process.env.AURORAFLOW_OBSERVABILITY_ENABLED ?? 'true',
    AURORAFLOW_OBSERVABILITY_ENVIRONMENT: process.env.AURORAFLOW_OBSERVABILITY_ENVIRONMENT ?? 'ci',
    AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS:
      process.env.AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS ?? '1000',
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_COLLECTOR_ENDPOINT,
  };
}

async function writeSmokeLog(): Promise<void> {
  const telemetry = initializeTelemetry({
    env: buildTelemetryEnvironment(),
    logger: diagnosticLogger,
  });
  const startedAt = performance.now();

  await telemetry.runSpan({
    name: SPAN_NAMES.testRun,
    attributes: {
      'auroraflow.ci.smoke': true,
      'auroraflow.project': 'observability-ci',
      'auroraflow.shard': '1/1',
    },
    task: async (span) => {
      telemetry.recordCounter(METRIC_NAMES.testRunsTotal, 1, {
        'auroraflow.report.kind': 'observability_ci_smoke',
      });
      telemetry.recordCounter(METRIC_NAMES.testCasesTotal, 1, {
        'auroraflow.test.status': 'passed',
        'auroraflow.project': 'observability-ci',
        'auroraflow.shard': '1/1',
      });
      telemetry.recordHistogram(METRIC_NAMES.testCaseDurationMs, 25, {
        'auroraflow.test.status': 'passed',
        'auroraflow.project': 'observability-ci',
        'auroraflow.shard': '1/1',
      });

      span.setAttribute('auroraflow.ci.smoke.succeeded', true);

      await mkdir(path.dirname(LOG_PATH), { recursive: true });
      await appendFile(
        LOG_PATH,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Observability CI smoke telemetry emitted.',
          component: 'observability-ci',
          runId: process.env.GITHUB_RUN_ID,
          workflow: process.env.GITHUB_WORKFLOW,
          branch: process.env.GITHUB_REF_NAME,
          commit: process.env.GITHUB_SHA,
          ...telemetry.getLogCorrelation(),
        })}\n`,
        'utf8',
      );
    },
  });

  await shutdownTelemetry();

  const diagnosticsDir =
    process.env.AURORAFLOW_OBSERVABILITY_DIAGNOSTICS_DIR ?? DEFAULT_DIAGNOSTICS_DIR;
  await mkdir(diagnosticsDir, { recursive: true });
  await writeFile(
    path.join(diagnosticsDir, 'smoke-result.json'),
    `${JSON.stringify(
      {
        emitted: true,
        durationMs: Math.round(performance.now() - startedAt),
        diagnosticEvents,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

const diagnosticEvents: DiagnosticEvent[] = [];

const diagnosticLogger: TelemetryDiagnosticLogger = {
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    diagnosticEvents.push({ level: 'error', message, metadata });
  },
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    diagnosticEvents.push({ level: 'warn', message, metadata });
  },
};

void writeSmokeLog().catch(async (error: unknown) => {
  diagnosticEvents.push({
    level: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  await shutdownTelemetry();
  throw error;
});
