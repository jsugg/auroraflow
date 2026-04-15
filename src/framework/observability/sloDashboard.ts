import type { FlakinessSummary } from './flakinessReport';

export type SloMetricKey =
  | 'passRate'
  | 'failureRate'
  | 'flakeRate'
  | 'retryFailureRate'
  | 'guardedAutoHealFailureRate';

export type SloMetricComparator = 'gte' | 'lte';
export type SloMetricStatus = 'met' | 'breached' | 'insufficient_data';

export interface SelfHealingGovernanceSummary {
  status?: string;
  triageRequired?: boolean;
  guardedAcceptedCount?: number;
  telemetry?: {
    guardedAutoHeal?: {
      attempted?: number;
      succeeded?: number;
      failed?: number;
      skipped?: number;
    };
  };
}

export interface SloMetricTarget {
  comparator: SloMetricComparator;
  threshold: number;
  rationale: string;
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
    guardedAcceptedCount: number;
    guardedAutoHealAttempts: number;
    guardedAutoHealSucceeded: number;
    guardedAutoHealFailed: number;
    guardedAutoHealSkipped: number;
  };
  metrics: SloMetric[];
}

const TARGETS: Readonly<Record<SloMetricKey, SloMetricTarget>> = Object.freeze({
  passRate: {
    comparator: 'gte',
    threshold: 0.98,
    rationale: 'Keep successful final outcomes at or above 98%.',
  },
  failureRate: {
    comparator: 'lte',
    threshold: 0.02,
    rationale: 'Keep hard-fail outcomes at or below 2%.',
  },
  flakeRate: {
    comparator: 'lte',
    threshold: 0.02,
    rationale: 'Keep flaky outcomes at or below 2%.',
  },
  retryFailureRate: {
    comparator: 'lte',
    threshold: 0.1,
    rationale: 'Keep failed-attempt pressure at or below 10% of all attempts.',
  },
  guardedAutoHealFailureRate: {
    comparator: 'lte',
    threshold: 0.05,
    rationale: 'Keep guarded auto-heal apply failures at or below 5% of attempts.',
  },
});

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
      target: TARGETS.passRate,
      status: toMetricStatus(metricValues.passRate, TARGETS.passRate),
    },
    {
      key: 'failureRate',
      label: 'Failure Rate',
      value: metricValues.failureRate,
      target: TARGETS.failureRate,
      status: toMetricStatus(metricValues.failureRate, TARGETS.failureRate),
    },
    {
      key: 'flakeRate',
      label: 'Flake Rate',
      value: metricValues.flakeRate,
      target: TARGETS.flakeRate,
      status: toMetricStatus(metricValues.flakeRate, TARGETS.flakeRate),
    },
    {
      key: 'retryFailureRate',
      label: 'Retry Failure Rate',
      value: metricValues.retryFailureRate,
      target: TARGETS.retryFailureRate,
      status: toMetricStatus(metricValues.retryFailureRate, TARGETS.retryFailureRate),
    },
    {
      key: 'guardedAutoHealFailureRate',
      label: 'Guarded Auto-Heal Failure Rate',
      value: metricValues.guardedAutoHealFailureRate,
      target: TARGETS.guardedAutoHealFailureRate,
      status: toMetricStatus(
        metricValues.guardedAutoHealFailureRate,
        TARGETS.guardedAutoHealFailureRate,
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
      guardedAcceptedCount: valueOrZero(governance?.guardedAcceptedCount),
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
