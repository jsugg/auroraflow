import type { AlertEvaluationResult } from './alertPolicies';
import {
  SPAN_NAMES,
  buildGuardedAutoHealMetricAttributes,
  type GuardedAutoHealMetricStatus,
} from './attributes';
import type { FinalTestStatus, FlakinessSummary } from './flakinessReport';
import { METRIC_NAMES, type MetricName } from './metricNames';
import type { SloDashboard, SloMetric, SloMetricStatus } from './sloDashboard';
import type { AuroraFlowTelemetry, TelemetryAttributes } from './telemetry';
import { getTelemetry } from './telemetry';

type ReportKind = 'flakiness' | 'slo_alerts' | 'slo_dashboard';
type TestAttemptMetricStatus = 'failed' | 'interrupted' | 'skipped' | 'succeeded' | 'unknown';

function buildReportAttributes({
  kind,
  status,
}: {
  kind: ReportKind;
  status: string;
}): TelemetryAttributes {
  return {
    'auroraflow.report.kind': kind,
    'auroraflow.report.status': status,
  };
}

function buildProjectAttributes(projectName: string): TelemetryAttributes {
  return {
    'auroraflow.project': projectName,
  };
}

function buildTestCaseAttributes({
  projectName,
  finalStatus,
}: {
  projectName: string;
  finalStatus: FinalTestStatus;
}): TelemetryAttributes {
  return {
    'auroraflow.project': projectName,
    'auroraflow.test.status': finalStatus,
  };
}

function buildTestAttemptAttributes({
  projectName,
  status,
}: {
  projectName: string;
  status: TestAttemptMetricStatus;
}): TelemetryAttributes {
  return {
    'auroraflow.project': projectName,
    'auroraflow.test_attempt.status': status,
  };
}

function buildSloMetricAttributes(metric: SloMetric): TelemetryAttributes {
  return {
    'auroraflow.slo.metric': metric.key,
    'auroraflow.slo.status': metric.status,
  };
}

function buildAlertAttributes({
  severity,
  metric,
}: {
  severity: string;
  metric?: string;
}): TelemetryAttributes {
  return {
    'auroraflow.alert.severity': severity,
    'auroraflow.slo.metric': metric,
  };
}

function toAttemptStatus(status: FinalTestStatus): TestAttemptMetricStatus {
  if (status === 'passed') {
    return 'succeeded';
  }
  if (status === 'failed' || status === 'timedOut') {
    return 'failed';
  }
  if (status === 'skipped' || status === 'interrupted') {
    return status;
  }
  return 'unknown';
}

function toReportStatus(status: SloMetricStatus): 'breached' | 'insufficient_data' | 'met' {
  return status;
}

function recordPositiveCounter(
  telemetry: AuroraFlowTelemetry,
  name: MetricName,
  value: number,
  attributes: TelemetryAttributes,
): void {
  if (value > 0) {
    telemetry.recordCounter(name, value, attributes);
  }
}

export async function runFlakinessReportTelemetry<TValue>({
  task,
  telemetry = getTelemetry(),
}: {
  task: () => Promise<{ summary: FlakinessSummary; value: TValue }>;
  telemetry?: AuroraFlowTelemetry;
}): Promise<TValue> {
  return telemetry.runSpan({
    name: SPAN_NAMES.reportFlakiness,
    task: async (span) => {
      const { summary, value } = await task();

      span.setAttribute('auroraflow.report.status', summary.status);
      span.setAttribute('auroraflow.report.source_files', summary.sourceFiles);
      span.setAttribute('auroraflow.test.count', summary.totalTests);
      telemetry.recordCounter(
        METRIC_NAMES.testRunsTotal,
        1,
        buildReportAttributes({ kind: 'flakiness', status: summary.status }),
      );

      for (const project of summary.projectBreakdown) {
        const projectAttributes = buildProjectAttributes(project.projectName);
        recordPositiveCounter(
          telemetry,
          METRIC_NAMES.flakyTestsTotal,
          project.flakyTests,
          projectAttributes,
        );
        recordPositiveCounter(
          telemetry,
          METRIC_NAMES.retryFailuresTotal,
          project.failedAttempts,
          projectAttributes,
        );
      }

      for (const testCase of summary.testCases) {
        telemetry.recordCounter(
          METRIC_NAMES.testCasesTotal,
          1,
          buildTestCaseAttributes({
            projectName: testCase.projectName,
            finalStatus: testCase.finalStatus,
          }),
        );
        recordPositiveCounter(
          telemetry,
          METRIC_NAMES.testAttemptsTotal,
          testCase.failedAttempts,
          buildTestAttemptAttributes({
            projectName: testCase.projectName,
            status: 'failed',
          }),
        );
        recordPositiveCounter(
          telemetry,
          METRIC_NAMES.testAttemptsTotal,
          testCase.attempts - testCase.failedAttempts,
          buildTestAttemptAttributes({
            projectName: testCase.projectName,
            status: toAttemptStatus(testCase.finalStatus),
          }),
        );
        if (testCase.durationMs > 0) {
          telemetry.recordHistogram(
            METRIC_NAMES.testCaseDurationMs,
            testCase.durationMs,
            buildTestCaseAttributes({
              projectName: testCase.projectName,
              finalStatus: testCase.finalStatus,
            }),
          );
        }
      }

      return value;
    },
  });
}

export function recordSloDashboardTelemetry(
  dashboard: SloDashboard,
  telemetry: AuroraFlowTelemetry = getTelemetry(),
): void {
  telemetry.recordCounter(
    METRIC_NAMES.testRunsTotal,
    1,
    buildReportAttributes({ kind: 'slo_dashboard', status: dashboard.overallStatus }),
  );

  recordPositiveCounter(telemetry, METRIC_NAMES.testCasesTotal, dashboard.totals.passedTests, {
    'auroraflow.test.status': 'passed',
  });
  recordPositiveCounter(telemetry, METRIC_NAMES.testCasesTotal, dashboard.totals.failedTests, {
    'auroraflow.test.status': 'failed',
  });
  recordPositiveCounter(telemetry, METRIC_NAMES.testCasesTotal, dashboard.totals.flakyTests, {
    'auroraflow.test.status': 'flaky',
  });
  recordPositiveCounter(
    telemetry,
    METRIC_NAMES.testAttemptsTotal,
    dashboard.totals.failedAttempts,
    {
      'auroraflow.test_attempt.status': 'failed',
    },
  );
  recordPositiveCounter(
    telemetry,
    METRIC_NAMES.testAttemptsTotal,
    Math.max(0, dashboard.totals.attempts - dashboard.totals.failedAttempts),
    {
      'auroraflow.test_attempt.status': 'succeeded',
    },
  );
  recordPositiveCounter(telemetry, METRIC_NAMES.flakyTestsTotal, dashboard.totals.flakyTests, {});
  recordPositiveCounter(
    telemetry,
    METRIC_NAMES.retryFailuresTotal,
    dashboard.totals.failedAttempts,
    {},
  );

  const guardedCounts: ReadonlyArray<{
    status: GuardedAutoHealMetricStatus;
    value: number;
  }> = [
    { status: 'succeeded', value: dashboard.selfHealing.guardedAutoHealSucceeded },
    { status: 'failed', value: dashboard.selfHealing.guardedAutoHealFailed },
    { status: 'skipped', value: dashboard.selfHealing.guardedAutoHealSkipped },
  ];
  for (const guardedCount of guardedCounts) {
    recordPositiveCounter(
      telemetry,
      METRIC_NAMES.guardedAutoHealTotal,
      guardedCount.value,
      buildGuardedAutoHealMetricAttributes({
        actionType: 'unknown',
        status: guardedCount.status,
      }),
    );
  }

  for (const metric of dashboard.metrics) {
    if (metric.value === null) {
      continue;
    }
    telemetry.recordHistogram(METRIC_NAMES.sloMetricValue, metric.value, {
      ...buildSloMetricAttributes(metric),
      'auroraflow.report.kind': 'slo_dashboard',
      'auroraflow.slo.report_status': toReportStatus(metric.status),
    });
  }
}

export async function runSloDashboardTelemetry<TValue>({
  task,
  telemetry = getTelemetry(),
}: {
  task: () => Promise<{ dashboard: SloDashboard; value: TValue }>;
  telemetry?: AuroraFlowTelemetry;
}): Promise<TValue> {
  return telemetry.runSpan({
    name: SPAN_NAMES.reportSloDashboard,
    task: async (span) => {
      const { dashboard, value } = await task();

      span.setAttribute('auroraflow.report.status', dashboard.status);
      span.setAttribute('auroraflow.slo.overall_status', dashboard.overallStatus);
      span.setAttribute('auroraflow.test.count', dashboard.totals.tests);
      recordSloDashboardTelemetry(dashboard, telemetry);
      return value;
    },
  });
}

export function recordSloAlertTelemetry(
  result: AlertEvaluationResult,
  telemetry: AuroraFlowTelemetry = getTelemetry(),
): void {
  telemetry.recordCounter(
    METRIC_NAMES.testRunsTotal,
    1,
    buildReportAttributes({ kind: 'slo_alerts', status: result.overallStatus }),
  );
  recordPositiveCounter(
    telemetry,
    METRIC_NAMES.sloAlertBreachesTotal,
    result.breachCount,
    buildAlertAttributes({ severity: 'any' }),
  );

  for (const breach of result.breaches) {
    telemetry.recordCounter(
      METRIC_NAMES.sloAlertBreachesTotal,
      1,
      buildAlertAttributes({
        severity: breach.severity,
        metric: breach.metric,
      }),
    );
  }
}

export async function runSloAlertTelemetry<TValue>({
  task,
  telemetry = getTelemetry(),
}: {
  task: () => Promise<{ result: AlertEvaluationResult; value: TValue }>;
  telemetry?: AuroraFlowTelemetry;
}): Promise<TValue> {
  return telemetry.runSpan({
    name: SPAN_NAMES.reportSloAlerts,
    task: async (span) => {
      const { result, value } = await task();

      span.setAttribute('auroraflow.report.status', result.overallStatus);
      span.setAttribute('auroraflow.slo.breach_count', result.breachCount);
      span.setAttribute('auroraflow.slo.blocking_breach_count', result.blockingBreachCount);
      recordSloAlertTelemetry(result, telemetry);
      return value;
    },
  });
}
