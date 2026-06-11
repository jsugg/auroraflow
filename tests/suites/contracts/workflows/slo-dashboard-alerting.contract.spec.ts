import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAlertPolicy } from '../../../../src/framework/observability/alertPolicies';
import {
  SLO_METRIC_TARGETS,
  type SloMetricComparator,
  type SloMetricKey,
} from '../../../../src/framework/observability/sloThresholds';
import { DEFAULT_SELF_HEAL_MIN_CONFIDENCE } from '../../../../src/framework/selfHealing/config';
import {
  SELF_HEALING_HEURISTIC_STRATEGY_BASE_SIGNAL,
  SELF_HEALING_SCORE_WEIGHTS,
  SELF_HEALING_VALIDATED_STRATEGY_RELIABILITY,
} from '../../../../src/framework/selfHealing/scoringPolicy';
import type {
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from '../../../../src/framework/selfHealing/types';

const CI_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/ci.yml');
const SLO_ALERT_POLICY_PATH = path.join(process.cwd(), 'configs/quality/slo-alert-policy.json');
const PROMETHEUS_RULES_PATH = path.join(
  process.cwd(),
  'observability/prometheus/rules/auroraflow.yml',
);
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');
const prometheusRules = readFileSync(PROMETHEUS_RULES_PATH, 'utf8');

const SLO_METRIC_KEYS = [
  'passRate',
  'failureRate',
  'flakeRate',
  'retryFailureRate',
  'guardedAutoHealFailureRate',
] as const satisfies readonly SloMetricKey[];

const PROMETHEUS_ALERTS: Readonly<
  Record<SloMetricKey, { alertName: string; operator: '<' | '>' }>
> = Object.freeze({
  passRate: { alertName: 'AuroraFlowPassRateLow', operator: '<' },
  failureRate: { alertName: 'AuroraFlowFailureRateHigh', operator: '>' },
  flakeRate: { alertName: 'AuroraFlowFlakeRateHigh', operator: '>' },
  retryFailureRate: { alertName: 'AuroraFlowRetryPressureHigh', operator: '>' },
  guardedAutoHealFailureRate: {
    alertName: 'AuroraFlowGuardedAutoHealFailureRateHigh',
    operator: '>',
  },
});
const SELF_HEALING_STRATEGIES = [
  'original',
  'testId',
  'roleName',
  'ariaLabel',
  'text',
  'cssFallback',
  'fallback',
  'registry',
  'domEvidence',
] as const satisfies readonly SelfHealingSuggestionStrategy[];
const INTENTIONAL_VALIDATED_RELIABILITY_OVERRIDES: Readonly<
  Partial<Record<SelfHealingSuggestionStrategy, { heuristic: number; validated: number }>>
> = Object.freeze({
  roleName: { heuristic: 0.78, validated: 0.9 },
  ariaLabel: { heuristic: 0.72, validated: 0.82 },
});

function breachOperatorFor(comparator: SloMetricComparator): 'gt' | 'lt' {
  return comparator === 'gte' ? 'lt' : 'gt';
}

function prometheusOperatorFor(comparator: SloMetricComparator): '<' | '>' {
  return comparator === 'gte' ? '<' : '>';
}

function extractAlertBlock(rules: string, alertName: string): string {
  const match = rules.match(
    new RegExp(`- alert: ${alertName}\\n([\\s\\S]*?)(?=\\n\\s*- alert:|\\n\\s*- name:|$)`),
  );
  if (!match?.[1]) {
    throw new Error(`Missing Prometheus alert: ${alertName}`);
  }
  return match[1];
}

function extractPrometheusThreshold({
  alertName,
  operator,
}: {
  alertName: string;
  operator: '<' | '>';
}): number {
  const block = extractAlertBlock(prometheusRules, alertName);
  const thresholdMatch = block.match(new RegExp(`\\${operator}\\s*([0-9]+(?:\\.[0-9]+)?)`));
  if (!thresholdMatch?.[1]) {
    throw new Error(`Missing Prometheus threshold for ${alertName}`);
  }
  return Number(thresholdMatch[1]);
}

function weightedScore(signals: SelfHealingSuggestionSignals): number {
  return (
    signals.roleSignal * SELF_HEALING_SCORE_WEIGHTS.roleSignal +
    signals.accessibleNameSignal * SELF_HEALING_SCORE_WEIGHTS.accessibleNameSignal +
    signals.uniquenessSignal * SELF_HEALING_SCORE_WEIGHTS.uniquenessSignal +
    signals.historicalSignal * SELF_HEALING_SCORE_WEIGHTS.historicalSignal +
    signals.similaritySignal * SELF_HEALING_SCORE_WEIGHTS.similaritySignal
  );
}

describe('ci.yml SLO dashboard and alerting contract', () => {
  it('defines a dedicated SLO dashboard and alerts job after flakiness aggregation', () => {
    expect(ciWorkflow).toContain('slo-dashboard:');
    expect(ciWorkflow).toContain('name: SLO Dashboard and Alerts');
    expect(ciWorkflow).toContain('needs: flakiness-report');
  });

  it('generates dashboard and alert artifacts with repository policy config', () => {
    expect(ciWorkflow).toContain('npm run slo:dashboard --');
    expect(ciWorkflow).toContain('npm run slo:alerts --');
    expect(ciWorkflow).toContain('configs/quality/slo-alert-policy.json');
    expect(ciWorkflow).toContain('Restore SLO trend history');
    expect(ciWorkflow).toContain('--trend-output .auroraflow-trends/slo-trends.jsonl');
    expect(ciWorkflow).toContain('name: slo-dashboard-alerts');
  });

  it('keeps dashboard, policy JSON, and Prometheus SLO thresholds aligned and warning-only', () => {
    const rawPolicy: unknown = JSON.parse(readFileSync(SLO_ALERT_POLICY_PATH, 'utf8'));
    const policy = parseAlertPolicy(rawPolicy);
    const ruleByMetric = new Map(policy.alerts.map((rule) => [rule.metric, rule]));

    for (const metricKey of SLO_METRIC_KEYS) {
      const target = SLO_METRIC_TARGETS[metricKey];
      const policyRule = ruleByMetric.get(metricKey);
      const prometheusAlert = PROMETHEUS_ALERTS[metricKey];

      expect(policyRule).toBeDefined();
      expect(policyRule?.operator).toBe(breachOperatorFor(target.comparator));
      expect(policyRule?.threshold).toBe(target.threshold);
      expect(policyRule?.severity).toBe('warning');
      expect(policyRule?.blockOnBreach ?? false).toBe(false);
      expect(prometheusAlert.operator).toBe(prometheusOperatorFor(target.comparator));
      expect(
        extractPrometheusThreshold({
          alertName: prometheusAlert.alertName,
          operator: prometheusAlert.operator,
        }),
      ).toBe(target.threshold);
      expect(extractAlertBlock(prometheusRules, prometheusAlert.alertName)).toMatch(
        /severity:\s*warning/,
      );
    }
  });
});

describe('scoring, guarded threshold, and SLO drift contract', () => {
  it('classifies self-healing scoring differences and preserves the default safety floor', () => {
    const scoringWeightTotal = Object.values(SELF_HEALING_SCORE_WEIGHTS).reduce(
      (total, value) => total + value,
      0,
    );
    const observedOverrides: Partial<
      Record<SelfHealingSuggestionStrategy, { heuristic: number; validated: number }>
    > = {};

    for (const strategy of SELF_HEALING_STRATEGIES) {
      const heuristic = SELF_HEALING_HEURISTIC_STRATEGY_BASE_SIGNAL[strategy];
      const validated = SELF_HEALING_VALIDATED_STRATEGY_RELIABILITY[strategy];
      if (heuristic !== validated) {
        observedOverrides[strategy] = { heuristic, validated };
      }
    }

    const freshDomCeiling = Math.max(
      weightedScore({
        roleSignal: 1,
        accessibleNameSignal: 1,
        uniquenessSignal: SELF_HEALING_VALIDATED_STRATEGY_RELIABILITY.testId,
        historicalSignal: 0.5,
        similaritySignal: 1,
      }),
      weightedScore({
        roleSignal: 1,
        accessibleNameSignal: 1,
        uniquenessSignal: SELF_HEALING_VALIDATED_STRATEGY_RELIABILITY.roleName,
        historicalSignal: 0.5,
        similaritySignal: 1,
      }),
    );

    expect(scoringWeightTotal).toBeCloseTo(1, 10);
    expect(Object.keys(SELF_HEALING_HEURISTIC_STRATEGY_BASE_SIGNAL).sort()).toEqual(
      [...SELF_HEALING_STRATEGIES].sort(),
    );
    expect(Object.keys(SELF_HEALING_VALIDATED_STRATEGY_RELIABILITY).sort()).toEqual(
      [...SELF_HEALING_STRATEGIES].sort(),
    );
    expect(observedOverrides).toEqual(INTENTIONAL_VALIDATED_RELIABILITY_OVERRIDES);
    expect(freshDomCeiling).toBeLessThan(DEFAULT_SELF_HEAL_MIN_CONFIDENCE);
  });
});
