import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildGuardedAutoHealMetricAttributes,
  buildGuardedValidationMetricAttributes,
  buildPageActionMetricAttributes,
  buildRedisOperationMetricAttributes,
  buildSelfHealingArtifactMetricAttributes,
  buildSelfHealingRegistryWriteMetricAttributes,
  buildSelfHealingSuggestionMetricAttributes,
  SPAN_NAMES,
} from '../src/framework/observability/attributes';
import { METRIC_NAMES } from '../src/framework/observability/metricNames';
import {
  initializeTelemetry,
  shutdownTelemetry,
  type AuroraFlowTelemetry,
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

function recordRepresentativeSmokeMetrics(telemetry: AuroraFlowTelemetry): void {
  const testAttributes = {
    'auroraflow.project': 'observability-ci',
    'auroraflow.shard': '1/1',
  };

  telemetry.recordCounter(METRIC_NAMES.testRunsTotal, 1, {
    'auroraflow.report.kind': 'observability_ci_smoke',
  });
  telemetry.recordCounter(METRIC_NAMES.testCasesTotal, 1, {
    ...testAttributes,
    'auroraflow.test.status': 'passed',
  });
  telemetry.recordCounter(METRIC_NAMES.testCasesTotal, 1, {
    ...testAttributes,
    'auroraflow.test.status': 'failed',
  });
  telemetry.recordCounter(METRIC_NAMES.testAttemptsTotal, 1, {
    ...testAttributes,
    'auroraflow.test_attempt.status': 'succeeded',
  });
  telemetry.recordCounter(METRIC_NAMES.testAttemptsTotal, 1, {
    ...testAttributes,
    'auroraflow.test_attempt.status': 'failed',
  });
  telemetry.recordHistogram(METRIC_NAMES.testCaseDurationMs, 25, {
    ...testAttributes,
    'auroraflow.test.status': 'passed',
  });
  telemetry.recordCounter(METRIC_NAMES.flakyTestsTotal, 1, {
    'auroraflow.project': 'observability-ci',
  });
  telemetry.recordCounter(METRIC_NAMES.retryFailuresTotal, 1, {
    'auroraflow.project': 'observability-ci',
  });
  telemetry.recordCounter(METRIC_NAMES.sloAlertBreachesTotal, 1, {
    'auroraflow.alert.severity': 'warning',
    'auroraflow.slo.metric': 'pass_rate',
  });

  for (const status of ['succeeded', 'failed', 'self_healed'] as const) {
    const metricAttributes = buildPageActionMetricAttributes({
      actionType: 'click',
      errorCode: status === 'failed' ? 'observability_smoke' : undefined,
      pageObjectName: 'ObservabilitySmokePage',
      status,
    });
    telemetry.recordCounter(METRIC_NAMES.pageActionsTotal, 1, metricAttributes);
    telemetry.recordHistogram(
      METRIC_NAMES.pageActionDurationMs,
      status === 'failed' ? 40 : 15,
      metricAttributes,
    );
  }
  telemetry.recordCounter(
    METRIC_NAMES.pageActionFailuresTotal,
    1,
    buildPageActionMetricAttributes({
      actionType: 'click',
      errorCode: 'observability_smoke',
      pageObjectName: 'ObservabilitySmokePage',
      status: 'failed',
    }),
  );

  telemetry.recordCounter(
    METRIC_NAMES.selfHealingArtifactsTotal,
    1,
    buildSelfHealingArtifactMetricAttributes({ actionType: 'click', mode: 'guarded' }),
  );
  telemetry.recordCounter(
    METRIC_NAMES.selfHealingSuggestionsTotal,
    1,
    buildSelfHealingSuggestionMetricAttributes({ strategy: 'roleName' }),
  );
  telemetry.recordCounter(
    METRIC_NAMES.guardedValidationCandidatesTotal,
    1,
    buildGuardedValidationMetricAttributes({ status: 'accepted', strategy: 'roleName' }),
  );
  telemetry.recordCounter(
    METRIC_NAMES.guardedValidationCandidatesTotal,
    1,
    buildGuardedValidationMetricAttributes({ status: 'no_matches', strategy: 'text' }),
  );

  for (const status of ['succeeded', 'failed', 'skipped'] as const) {
    telemetry.recordCounter(
      METRIC_NAMES.guardedAutoHealTotal,
      1,
      buildGuardedAutoHealMetricAttributes({
        actionType: 'click',
        skippedReason: status === 'skipped' ? 'no_accepted_locator' : undefined,
        status,
      }),
    );
  }
  telemetry.recordCounter(
    METRIC_NAMES.selfHealingRegistryWritesTotal,
    1,
    buildSelfHealingRegistryWriteMetricAttributes({
      actionType: 'click',
      mode: 'write_pending',
      operation: 'history_observation',
      status: 'succeeded',
    }),
  );

  for (const status of ['succeeded', 'failed'] as const) {
    const metricAttributes = buildRedisOperationMetricAttributes({
      operationName: status === 'succeeded' ? 'get' : 'compare-and-set',
      status,
    });
    telemetry.recordCounter(METRIC_NAMES.redisOperationsTotal, 1, metricAttributes);
    telemetry.recordHistogram(METRIC_NAMES.redisOperationDurationMs, status === 'failed' ? 30 : 8, {
      ...metricAttributes,
    });
    if (status === 'failed') {
      telemetry.recordCounter(METRIC_NAMES.redisOperationRetriesTotal, 1, metricAttributes);
    }
  }
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
      recordRepresentativeSmokeMetrics(telemetry);
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
