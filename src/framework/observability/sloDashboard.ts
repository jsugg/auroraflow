import type { FlakinessSummary } from './flakinessReport';
import { SLO_METRIC_TARGETS, type SloMetricKey, type SloMetricTarget } from './sloThresholds';

export type { SloMetricComparator, SloMetricKey, SloMetricTarget } from './sloThresholds';
export type SloMetricStatus = 'met' | 'breached' | 'insufficient_data';

export interface SelfHealingGovernanceSummary {
  status?: string;
  triageRequired?: boolean;
  guardedAcceptedCount?: number;
  pendingPromotionCount?: number;
  registryPersistenceFailureCount?: number;
  telemetry?: {
    guardedAutoHeal?: {
      attempted?: number;
      succeeded?: number;
      failed?: number;
      skipped?: number;
    };
    pendingPromotionWrites?: {
      succeeded?: number;
      failed?: number;
      skipped?: number;
    };
  };
}

export interface SloMetric {
  key: SloMetricKey;
  label: string;
  value: number | null;
  target: SloMetricTarget;
  status: SloMetricStatus;
}

export interface SloDashboard {
  generatedAt: string;
  status: 'complete' | 'no-input';
  overallStatus: 'healthy' | 'degraded' | 'insufficient_data';
  sourceFiles: number;
  totals: {
    tests: number;
    attempts: number;
    failedAttempts: number;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
  };
  selfHealing: {
    governanceStatus?: string;
    triageRequired: boolean;
    pendingPromotionCount: number;
    guardedAcceptedCount: number;
    registryPersistenceFailureCount: number;
    guardedAutoHealAttempts: number;
    guardedAutoHealSucceeded: number;
    guardedAutoHealFailed: number;
    guardedAutoHealSkipped: number;
  };
  metrics: SloMetric[];
}

function toRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function toMetricStatus(value: number | null, target: SloMetricTarget): SloMetricStatus {
  if (value === null) {
    return 'insufficient_data';
  }

  if (target.comparator === 'gte') {
    return value >= target.threshold ? 'met' : 'breached';
  }

  return value <= target.threshold ? 'met' : 'breached';
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatTarget(target: SloMetricTarget): string {
  const operator = target.comparator === 'gte' ? '>=' : '<=';
  return `${operator} ${(target.threshold * 100).toFixed(2)}%`;
}

function buildOverallStatus(metrics: ReadonlyArray<SloMetric>): SloDashboard['overallStatus'] {
  if (metrics.some((metric) => metric.status === 'breached')) {
    return 'degraded';
  }

  const metCount = metrics.filter((metric) => metric.status === 'met').length;
  if (metCount > 0) {
    return 'healthy';
  }

  return 'insufficient_data';
}

function valueOrZero(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function buildSloDashboard({
  flakiness,
  governance,
  generatedAt = new Date(),
}: {
  flakiness: FlakinessSummary;
  governance?: SelfHealingGovernanceSummary;
  generatedAt?: Date;
}): SloDashboard {
  const guardedAutoHeal = governance?.telemetry?.guardedAutoHeal;
  const guardedAttempts = valueOrZero(guardedAutoHeal?.attempted);
  const guardedSucceeded = valueOrZero(guardedAutoHeal?.succeeded);
  const guardedFailed = valueOrZero(guardedAutoHeal?.failed);
  const guardedSkipped = valueOrZero(guardedAutoHeal?.skipped);

  const metricValues: Readonly<Record<SloMetricKey, number | null>> = {
    passRate: toRatio(flakiness.passedTests, flakiness.totalTests),
    failureRate: toRatio(flakiness.failedTests, flakiness.totalTests),
    flakeRate: toRatio(flakiness.flakyTests, flakiness.totalTests),
    retryFailureRate: toRatio(flakiness.totalFailedAttempts, flakiness.totalAttempts),
    guardedAutoHealFailureRate: toRatio(guardedFailed, guardedAttempts),
  };

  const metrics: SloMetric[] = [
    {
      key: 'passRate',
      label: 'Pass Rate',
      value: metricValues.passRate,
      target: SLO_METRIC_TARGETS.passRate,
      status: toMetricStatus(metricValues.passRate, SLO_METRIC_TARGETS.passRate),
    },
    {
      key: 'failureRate',
      label: 'Failure Rate',
      value: metricValues.failureRate,
      target: SLO_METRIC_TARGETS.failureRate,
      status: toMetricStatus(metricValues.failureRate, SLO_METRIC_TARGETS.failureRate),
    },
    {
      key: 'flakeRate',
      label: 'Flake Rate',
      value: metricValues.flakeRate,
      target: SLO_METRIC_TARGETS.flakeRate,
      status: toMetricStatus(metricValues.flakeRate, SLO_METRIC_TARGETS.flakeRate),
    },
    {
      key: 'retryFailureRate',
      label: 'Retry Failure Rate',
      value: metricValues.retryFailureRate,
      target: SLO_METRIC_TARGETS.retryFailureRate,
      status: toMetricStatus(metricValues.retryFailureRate, SLO_METRIC_TARGETS.retryFailureRate),
    },
    {
      key: 'guardedAutoHealFailureRate',
      label: 'Guarded Auto-Heal Failure Rate',
      value: metricValues.guardedAutoHealFailureRate,
      target: SLO_METRIC_TARGETS.guardedAutoHealFailureRate,
      status: toMetricStatus(
        metricValues.guardedAutoHealFailureRate,
        SLO_METRIC_TARGETS.guardedAutoHealFailureRate,
      ),
    },
  ];

  return {
    generatedAt: generatedAt.toISOString(),
    status: flakiness.status,
    overallStatus: buildOverallStatus(metrics),
    sourceFiles: flakiness.sourceFiles,
    totals: {
      tests: flakiness.totalTests,
      attempts: flakiness.totalAttempts,
      failedAttempts: flakiness.totalFailedAttempts,
      passedTests: flakiness.passedTests,
      failedTests: flakiness.failedTests,
      flakyTests: flakiness.flakyTests,
    },
    selfHealing: {
      governanceStatus: governance?.status,
      triageRequired: governance?.triageRequired ?? false,
      pendingPromotionCount: valueOrZero(governance?.pendingPromotionCount),
      guardedAcceptedCount: valueOrZero(governance?.guardedAcceptedCount),
      registryPersistenceFailureCount: valueOrZero(governance?.registryPersistenceFailureCount),
      guardedAutoHealAttempts: guardedAttempts,
      guardedAutoHealSucceeded: guardedSucceeded,
      guardedAutoHealFailed: guardedFailed,
      guardedAutoHealSkipped: guardedSkipped,
    },
    metrics,
  };
}

export function buildSloDashboardMarkdown(dashboard: SloDashboard): string {
  const rows =
    dashboard.metrics.length === 0
      ? '| _none_ | _none_ | _none_ | _none_ | _none_ |\n'
      : dashboard.metrics
          .map(
            (metric) =>
              `| ${metric.label} | ${formatPercent(metric.value)} | ${formatTarget(metric.target)} | ${metric.status} | ${metric.target.rationale} |`,
          )
          .join('\n');

  return [
    '# SLO Dashboard',
    '',
    `- Generated at: ${dashboard.generatedAt}`,
    `- Dashboard status: ${dashboard.status}`,
    `- Overall status: ${dashboard.overallStatus}`,
    `- Source files: ${dashboard.sourceFiles}`,
    '',
    '## Totals',
    '',
    `- Total tests: ${dashboard.totals.tests}`,
    `- Passed tests: ${dashboard.totals.passedTests}`,
    `- Failed tests: ${dashboard.totals.failedTests}`,
    `- Flaky tests: ${dashboard.totals.flakyTests}`,
    `- Total attempts: ${dashboard.totals.attempts}`,
    `- Failed attempts: ${dashboard.totals.failedAttempts}`,
    '',
    '## Self-Healing Governance',
    '',
    `- Governance status: ${dashboard.selfHealing.governanceStatus ?? 'n/a'}`,
    `- Triage required: ${dashboard.selfHealing.triageRequired}`,
    `- Guarded accepted count: ${dashboard.selfHealing.guardedAcceptedCount}`,
    `- Guarded auto-heal attempts: ${dashboard.selfHealing.guardedAutoHealAttempts}`,
    `- Guarded auto-heal succeeded: ${dashboard.selfHealing.guardedAutoHealSucceeded}`,
    `- Guarded auto-heal failed: ${dashboard.selfHealing.guardedAutoHealFailed}`,
    `- Guarded auto-heal skipped: ${dashboard.selfHealing.guardedAutoHealSkipped}`,
    '',
    '## KPI Status',
    '',
    '| Metric | Value | Target | Status | Rationale |',
    '|---|---:|---:|---|---|',
    rows,
    '',
  ].join('\n');
}
