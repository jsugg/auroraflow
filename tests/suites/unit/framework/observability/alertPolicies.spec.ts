import { describe, expect, it } from 'vitest';
import {
  AlertPolicyValidationError,
  buildAlertEvaluationMarkdown,
  evaluateAlertPolicy,
  parseAlertPolicy,
} from '../../../../../src/framework/observability/alertPolicies';
import type { SloDashboard } from '../../../../../src/framework/observability/sloDashboard';

function createDashboard(overrides: Partial<SloDashboard> = {}): SloDashboard {
  return {
    generatedAt: '2026-04-15T12:00:00.000Z',
    status: 'complete',
    overallStatus: 'healthy',
    sourceFiles: 2,
    totals: {
      tests: 100,
      attempts: 110,
      failedAttempts: 5,
      passedTests: 98,
      failedTests: 1,
      flakyTests: 1,
    },
    selfHealing: {
      triageRequired: false,
      guardedAcceptedCount: 0,
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
        target: {
          comparator: 'gte',
          threshold: 0.98,
          rationale: 'pass rate target',
        },
      },
      {
        key: 'failureRate',
        label: 'Failure Rate',
        value: 0.01,
        status: 'met',
        target: {
          comparator: 'lte',
          threshold: 0.02,
          rationale: 'failure rate target',
        },
      },
      {
        key: 'flakeRate',
        label: 'Flake Rate',
        value: 0.01,
        status: 'met',
        target: {
          comparator: 'lte',
          threshold: 0.02,
          rationale: 'flake rate target',
        },
      },
      {
        key: 'retryFailureRate',
        label: 'Retry Failure Rate',
        value: 0.045,
        status: 'met',
        target: {
          comparator: 'lte',
          threshold: 0.1,
          rationale: 'retry failure target',
        },
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

describe('parseAlertPolicy', () => {
  it('parses a valid policy document', () => {
    const policy = parseAlertPolicy({
      version: '1.0.0',
      alerts: [
        {
          id: 'flake-rate-breach',
          metric: 'flakeRate',
          operator: 'gt',
          threshold: 0.02,
          severity: 'critical',
          description: 'Flake rate is too high.',
          blockOnBreach: true,
        },
      ],
    });

    expect(policy.alerts).toHaveLength(1);
    expect(policy.alerts[0]).toMatchObject({
      metric: 'flakeRate',
      operator: 'gt',
      threshold: 0.02,
      blockOnBreach: true,
    });
  });

  it('throws a typed error for malformed policy payloads', () => {
    expect(() =>
      parseAlertPolicy({
        version: '1.0.0',
        alerts: [
          {
            id: '',
            metric: 'flakeRate',
            operator: 'gt',
            threshold: 0.02,
            severity: 'critical',
            description: 'invalid',
          },
        ],
      }),
    ).toThrowError(AlertPolicyValidationError);
  });
});

describe('evaluateAlertPolicy', () => {
  const policy = parseAlertPolicy({
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
      {
        id: 'flake-rate-high',
        metric: 'flakeRate',
        operator: 'gt',
        threshold: 0.02,
        severity: 'critical',
        description: 'Flake rate above threshold.',
        blockOnBreach: true,
      },
    ],
  });

  it('returns no breaches when values remain within policy thresholds', () => {
    const result = evaluateAlertPolicy({
      dashboard: createDashboard(),
      policy,
      generatedAt: new Date('2026-04-15T13:00:00.000Z'),
    });

    expect(result.generatedAt).toBe('2026-04-15T13:00:00.000Z');
    expect(result.breachCount).toBe(0);
    expect(result.blockingBreachCount).toBe(0);
    expect(result.breaches).toEqual([]);
  });

  it('detects breaches and counts blocking alerts', () => {
    const result = evaluateAlertPolicy({
      dashboard: createDashboard({
        metrics: createDashboard().metrics.map((metric) =>
          metric.key === 'flakeRate'
            ? { ...metric, value: 0.08, status: 'breached' }
            : metric.key === 'passRate'
              ? { ...metric, value: 0.9, status: 'breached' }
              : metric,
        ),
        overallStatus: 'degraded',
      }),
      policy,
    });

    expect(result.breachCount).toBe(2);
    expect(result.blockingBreachCount).toBe(1);
    expect(result.breaches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'pass-rate-low', severity: 'warning', blockOnBreach: false }),
        expect.objectContaining({
          id: 'flake-rate-high',
          severity: 'critical',
          blockOnBreach: true,
        }),
      ]),
    );
  });
});

describe('buildAlertEvaluationMarkdown', () => {
  it('renders markdown with breach table rows', () => {
    const result = evaluateAlertPolicy({
      dashboard: createDashboard({
        metrics: createDashboard().metrics.map((metric) =>
          metric.key === 'flakeRate' ? { ...metric, value: 0.08, status: 'breached' } : metric,
        ),
      }),
      policy: parseAlertPolicy({
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
      }),
      generatedAt: new Date('2026-04-15T14:00:00.000Z'),
    });

    const markdown = buildAlertEvaluationMarkdown(result);
    expect(markdown).toContain('# SLO Alert Evaluation');
    expect(markdown).toContain('- Breaches: 1');
    expect(markdown).toContain(
      '| flake-rate-high | flakeRate | critical | 8.00% | gt 2.00% | false |',
    );
  });
});
