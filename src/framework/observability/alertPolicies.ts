import type { SloDashboard, SloMetricKey } from './sloDashboard';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertOperator = 'gt' | 'gte' | 'lt' | 'lte';

export interface AlertRule {
  id: string;
  metric: SloMetricKey;
  operator: AlertOperator;
  threshold: number;
  severity: AlertSeverity;
  description: string;
  blockOnBreach?: boolean;
}

export interface AlertPolicy {
  version: '1.0.0';
  alerts: AlertRule[];
}

export interface AlertBreach {
  id: string;
  metric: SloMetricKey;
  severity: AlertSeverity;
  description: string;
  operator: AlertOperator;
  threshold: number;
  actualValue: number;
  blockOnBreach: boolean;
}

export interface AlertEvaluationResult {
  generatedAt: string;
  dashboardGeneratedAt: string;
  overallStatus: SloDashboard['overallStatus'];
  breachCount: number;
  blockingBreachCount: number;
  breaches: AlertBreach[];
}

const VALID_OPERATORS: ReadonlySet<AlertOperator> = new Set(['gt', 'gte', 'lt', 'lte']);
const VALID_SEVERITIES: ReadonlySet<AlertSeverity> = new Set(['info', 'warning', 'critical']);
const VALID_METRICS: ReadonlySet<SloMetricKey> = new Set([
  'passRate',
  'failureRate',
  'flakeRate',
  'retryFailureRate',
  'guardedAutoHealFailureRate',
]);

export class AlertPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertPolicyValidationError';
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function evaluateThreshold({
  value,
  threshold,
  operator,
}: {
  value: number;
  threshold: number;
  operator: AlertOperator;
}): boolean {
  if (operator === 'gt') {
    return value > threshold;
  }
  if (operator === 'gte') {
    return value >= threshold;
  }
  if (operator === 'lt') {
    return value < threshold;
  }
  return value <= threshold;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function extractRule(rawRule: unknown, index: number): AlertRule {
  const ruleRecord = toRecord(rawRule);
  if (!ruleRecord) {
    throw new AlertPolicyValidationError(`alerts[${index}] must be an object.`);
  }

  const id = toNonEmptyString(ruleRecord.id);
  if (!id) {
    throw new AlertPolicyValidationError(`alerts[${index}].id must be a non-empty string.`);
  }

  const metric = toNonEmptyString(ruleRecord.metric);
  if (!metric || !VALID_METRICS.has(metric as SloMetricKey)) {
    throw new AlertPolicyValidationError(`alerts[${index}].metric is invalid: ${String(metric)}.`);
  }

  const operator = toNonEmptyString(ruleRecord.operator);
  if (!operator || !VALID_OPERATORS.has(operator as AlertOperator)) {
    throw new AlertPolicyValidationError(
      `alerts[${index}].operator is invalid: ${String(operator)}.`,
    );
  }

  const threshold = toNumber(ruleRecord.threshold);
  if (threshold === null || threshold < 0 || threshold > 1) {
    throw new AlertPolicyValidationError(
      `alerts[${index}].threshold must be a number between 0 and 1.`,
    );
  }

  const severity = toNonEmptyString(ruleRecord.severity);
  if (!severity || !VALID_SEVERITIES.has(severity as AlertSeverity)) {
    throw new AlertPolicyValidationError(
      `alerts[${index}].severity is invalid: ${String(severity)}.`,
    );
  }

  const description = toNonEmptyString(ruleRecord.description);
  if (!description) {
    throw new AlertPolicyValidationError(
      `alerts[${index}].description must be a non-empty string.`,
    );
  }

  const blockOnBreach =
    typeof ruleRecord.blockOnBreach === 'boolean' ? ruleRecord.blockOnBreach : false;

  return {
    id,
    metric: metric as SloMetricKey,
    operator: operator as AlertOperator,
    threshold,
    severity: severity as AlertSeverity,
    description,
    blockOnBreach,
  };
}

export function parseAlertPolicy(rawPolicy: unknown): AlertPolicy {
  const policyRecord = toRecord(rawPolicy);
  if (!policyRecord) {
    throw new AlertPolicyValidationError('Policy must be an object.');
  }

  const version = toNonEmptyString(policyRecord.version);
  if (version !== '1.0.0') {
    throw new AlertPolicyValidationError(`Policy version must be 1.0.0. Received: ${version}`);
  }

  if (!Array.isArray(policyRecord.alerts)) {
    throw new AlertPolicyValidationError('Policy alerts must be an array.');
  }

  return {
    version: '1.0.0',
    alerts: policyRecord.alerts.map((rule, index) => extractRule(rule, index)),
  };
}

export function evaluateAlertPolicy({
  dashboard,
  policy,
  generatedAt = new Date(),
}: {
  dashboard: SloDashboard;
  policy: AlertPolicy;
  generatedAt?: Date;
}): AlertEvaluationResult {
  const valueByMetric = new Map<SloMetricKey, number>();
  for (const metric of dashboard.metrics) {
    if (metric.value !== null) {
      valueByMetric.set(metric.key, metric.value);
    }
  }

  const breaches: AlertBreach[] = [];
  for (const rule of policy.alerts) {
    const value = valueByMetric.get(rule.metric);
    if (value === undefined) {
      continue;
    }

    if (
      evaluateThreshold({
        value,
        threshold: rule.threshold,
        operator: rule.operator,
      })
    ) {
      breaches.push({
        id: rule.id,
        metric: rule.metric,
        severity: rule.severity,
        description: rule.description,
        operator: rule.operator,
        threshold: rule.threshold,
        actualValue: value,
        blockOnBreach: rule.blockOnBreach ?? false,
      });
    }
  }

  const blockingBreachCount = breaches.filter((breach) => breach.blockOnBreach).length;
  return {
    generatedAt: generatedAt.toISOString(),
    dashboardGeneratedAt: dashboard.generatedAt,
    overallStatus: dashboard.overallStatus,
    breachCount: breaches.length,
    blockingBreachCount,
    breaches,
  };
}

export function buildAlertEvaluationMarkdown(result: AlertEvaluationResult): string {
  const rows =
    result.breaches.length === 0
      ? '| _none_ | _none_ | _none_ | _none_ | _none_ | _none_ |\n'
      : result.breaches
          .map(
            (breach) =>
              `| ${breach.id} | ${breach.metric} | ${breach.severity} | ${formatPercent(breach.actualValue)} | ${breach.operator} ${formatPercent(breach.threshold)} | ${breach.blockOnBreach} |`,
          )
          .join('\n');

  return [
    '# SLO Alert Evaluation',
    '',
    `- Generated at: ${result.generatedAt}`,
    `- Dashboard generated at: ${result.dashboardGeneratedAt}`,
    `- Dashboard overall status: ${result.overallStatus}`,
    `- Breaches: ${result.breachCount}`,
    `- Blocking breaches: ${result.blockingBreachCount}`,
    '',
    '| Alert ID | Metric | Severity | Actual | Threshold | Block |',
    '|---|---|---|---:|---:|---|',
    rows,
    '',
  ].join('\n');
}
