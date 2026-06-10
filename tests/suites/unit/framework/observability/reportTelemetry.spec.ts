import { describe, expect, it } from 'vitest';
import type { AlertEvaluationResult } from '../../../../../src/framework/observability/alertPolicies';
import { SPAN_NAMES } from '../../../../../src/framework/observability/attributes';
import type { FlakinessSummary } from '../../../../../src/framework/observability/flakinessReport';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  runFlakinessReportTelemetry,
  runSloAlertTelemetry,
  runSloDashboardTelemetry,
} from '../../../../../src/framework/observability/reportTelemetry';
import type { SloDashboard } from '../../../../../src/framework/observability/sloDashboard';
import { CapturingTelemetry } from './capturingTelemetry';

function createFlakinessSummary(): FlakinessSummary {
  return {
    generatedAt: '2026-04-15T12:00:00.000Z',
    status: 'complete',
    sourceFiles: 1,
    totalTests: 2,
    flakyTests: 1,
    failedTests: 1,
    passedTests: 1,
    skippedTests: 0,
    interruptedTests: 0,
    totalAttempts: 4,
    totalFailedAttempts: 2,
    projectBreakdown: [
      {
        projectName: 'Google Chrome',
        totalTests: 2,
        flakyTests: 1,
        failedTests: 1,
        totalAttempts: 4,
        failedAttempts: 2,
      },
    ],
    topFlakyCases: [],
    testCases: [
      {
        caseId: 'chrome::login',
        projectName: 'Google Chrome',
        file: 'tests/login.spec.ts',
        line: 10,
        column: 3,
        titlePath: ['auth', 'login'],
        fullTitle: 'auth > login',
        attempts: 2,
        retriesUsed: 1,
        failedAttempts: 1,
        durationMs: 125,
        finalStatus: 'passed',
        flaky: true,
      },
      {
        caseId: 'chrome::checkout',
        projectName: 'Google Chrome',
        file: 'tests/checkout.spec.ts',
        line: 20,
        column: 5,
        titlePath: ['checkout'],
        fullTitle: 'checkout',
        attempts: 2,
        retriesUsed: 1,
        failedAttempts: 1,
        durationMs: 250,
        finalStatus: 'failed',
        flaky: false,
      },
    ],
  };
}

function createDashboard(): SloDashboard {
  return {
    generatedAt: '2026-04-15T12:30:00.000Z',
    status: 'complete',
    overallStatus: 'degraded',
    sourceFiles: 1,
    totals: {
      tests: 2,
      attempts: 4,
      failedAttempts: 2,
      passedTests: 1,
      failedTests: 1,
      flakyTests: 1,
    },
    selfHealing: {
      triageRequired: false,
      pendingPromotionCount: 0,
      guardedAcceptedCount: 1,
      registryPersistenceFailureCount: 0,
      guardedAutoHealAttempts: 2,
      guardedAutoHealSucceeded: 1,
      guardedAutoHealFailed: 1,
      guardedAutoHealSkipped: 0,
    },
    metrics: [
      {
        key: 'passRate',
        label: 'Pass Rate',
        value: 0.5,
        status: 'breached',
        target: {
          comparator: 'gte',
          threshold: 0.98,
          rationale: 'pass rate target',
        },
      },
      {
        key: 'flakeRate',
        label: 'Flake Rate',
        value: 0.5,
        status: 'breached',
        target: {
          comparator: 'lte',
          threshold: 0.02,
          rationale: 'flake rate target',
        },
      },
    ],
  };
}

function createAlertResult(): AlertEvaluationResult {
  return {
    generatedAt: '2026-04-15T13:00:00.000Z',
    dashboardGeneratedAt: '2026-04-15T12:30:00.000Z',
    overallStatus: 'degraded',
    breachCount: 2,
    blockingBreachCount: 1,
    breaches: [
      {
        id: 'pass-rate-low',
        metric: 'passRate',
        severity: 'warning',
        description: 'Pass rate below target.',
        operator: 'lt',
        threshold: 0.98,
        actualValue: 0.5,
        blockOnBreach: false,
      },
      {
        id: 'flake-rate-high',
        metric: 'flakeRate',
        severity: 'critical',
        description: 'Flake rate above target.',
        operator: 'gt',
        threshold: 0.02,
        actualValue: 0.5,
        blockOnBreach: true,
      },
    ],
  };
}

describe('report telemetry helpers', () => {
  it('records flakiness report spans, counters, and test duration histograms', async () => {
    const telemetry = new CapturingTelemetry();
    const summary = createFlakinessSummary();

    await expect(
      runFlakinessReportTelemetry({
        telemetry,
        task: async () => ({ summary, value: 'done' }),
      }),
    ).resolves.toBe('done');

    expect(telemetry.spans).toEqual([
      expect.objectContaining({
        name: SPAN_NAMES.reportFlakiness,
        attributes: expect.objectContaining({
          'auroraflow.report.status': 'complete',
          'auroraflow.test.count': 2,
        }),
      }),
    ]);
    expect(telemetry.counters).toEqual(
      expect.arrayContaining([
        {
          name: METRIC_NAMES.testRunsTotal,
          value: 1,
          attributes: {
            'auroraflow.report.kind': 'flakiness',
            'auroraflow.report.status': 'complete',
          },
        },
        {
          name: METRIC_NAMES.testCasesTotal,
          value: 1,
          attributes: {
            'auroraflow.project': 'Google Chrome',
            'auroraflow.test.status': 'passed',
          },
        },
        {
          name: METRIC_NAMES.testAttemptsTotal,
          value: 1,
          attributes: {
            'auroraflow.project': 'Google Chrome',
            'auroraflow.test_attempt.status': 'failed',
          },
        },
      ]),
    );
    expect(telemetry.histograms).toEqual(
      expect.arrayContaining([
        {
          name: METRIC_NAMES.testCaseDurationMs,
          value: 125,
          attributes: {
            'auroraflow.project': 'Google Chrome',
            'auroraflow.test.status': 'passed',
          },
        },
      ]),
    );
  });

  it('records SLO dashboard metric values and aggregate governance counters', async () => {
    const telemetry = new CapturingTelemetry();
    const dashboard = createDashboard();

    await runSloDashboardTelemetry({
      telemetry,
      task: async () => ({ dashboard, value: undefined }),
    });

    expect(telemetry.spans[0]).toEqual(
      expect.objectContaining({
        name: SPAN_NAMES.reportSloDashboard,
        attributes: expect.objectContaining({
          'auroraflow.slo.overall_status': 'degraded',
          'auroraflow.test.count': 2,
        }),
      }),
    );
    expect(telemetry.counters).toEqual(
      expect.arrayContaining([
        {
          name: METRIC_NAMES.guardedAutoHealTotal,
          value: 1,
          attributes: {
            'auroraflow.action.type': 'unknown',
            'auroraflow.self_heal.status': 'failed',
          },
        },
      ]),
    );
    expect(telemetry.histograms).toEqual(
      expect.arrayContaining([
        {
          name: METRIC_NAMES.sloMetricValue,
          value: 0.5,
          attributes: {
            'auroraflow.report.kind': 'slo_dashboard',
            'auroraflow.slo.metric': 'passRate',
            'auroraflow.slo.report_status': 'breached',
            'auroraflow.slo.status': 'breached',
          },
        },
      ]),
    );
  });

  it('records SLO alert breach counters without raw alert descriptions', async () => {
    const telemetry = new CapturingTelemetry();
    const result = createAlertResult();

    await runSloAlertTelemetry({
      telemetry,
      task: async () => ({ result, value: 1 }),
    });

    expect(telemetry.spans[0]).toEqual(
      expect.objectContaining({
        name: SPAN_NAMES.reportSloAlerts,
        attributes: expect.objectContaining({
          'auroraflow.slo.breach_count': 2,
          'auroraflow.slo.blocking_breach_count': 1,
        }),
      }),
    );
    expect(telemetry.counters).toEqual(
      expect.arrayContaining([
        {
          name: METRIC_NAMES.sloAlertBreachesTotal,
          value: 2,
          attributes: {
            'auroraflow.alert.severity': 'any',
          },
        },
        {
          name: METRIC_NAMES.sloAlertBreachesTotal,
          value: 1,
          attributes: {
            'auroraflow.alert.severity': 'critical',
            'auroraflow.slo.metric': 'flakeRate',
          },
        },
      ]),
    );
    expect(JSON.stringify(telemetry)).not.toContain('Flake rate above target.');
  });
});
