export type SloMetricKey =
  | 'passRate'
  | 'failureRate'
  | 'flakeRate'
  | 'retryFailureRate'
  | 'guardedAutoHealFailureRate';

export type SloMetricComparator = 'gte' | 'lte';

export interface SloMetricTarget {
  comparator: SloMetricComparator;
  threshold: number;
  rationale: string;
}

export const SLO_METRIC_TARGETS: Readonly<Record<SloMetricKey, SloMetricTarget>> = Object.freeze({
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
