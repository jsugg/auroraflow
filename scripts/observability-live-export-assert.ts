import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { METRIC_NAMES, REQUIRED_METRIC_NAMES } from '../src/framework/observability/metricNames';

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

interface PrometheusSeriesSnapshot {
  readonly labelNames: readonly string[];
  readonly labelValues: Readonly<Record<string, readonly string[]>>;
  readonly queryResultCount: number;
  readonly seriesCount: number;
}

interface DashboardExpression {
  readonly expression: string;
  readonly legendFormat?: string;
  readonly source: string;
}

interface PrometheusLabelMatcher {
  readonly labelName: string;
  readonly operator: '=' | '!=' | '=~' | '!~';
  readonly value: string;
}

export interface ObservabilityLiveExportAssertOptions {
  readonly dashboardDir: string;
  readonly maxAttempts: number;
  readonly outputDir: string;
  readonly pollIntervalMs: number;
  readonly prometheusUrl: string;
  readonly rulesPath: string;
  readonly timeoutMs: number;
}

export interface PrometheusLabelSnapshot {
  readonly dashboardChecks: {
    readonly expressionCount: number;
    readonly sources: readonly string[];
  };
  readonly generatedAt: string;
  readonly metrics: Readonly<Record<string, PrometheusSeriesSnapshot>>;
  readonly prometheus: {
    readonly labelCount: number;
    readonly labels: readonly string[];
    readonly rules: {
      readonly expectedAlertNames: readonly string[];
      readonly loadedAlertNames: readonly string[];
    };
    readonly url: string;
  };
  readonly schemaVersion: 1;
}

const DEFAULT_DASHBOARD_DIR = path.join('observability', 'grafana', 'dashboards');
const DEFAULT_MAX_ATTEMPTS = 30;
const DEFAULT_OUTPUT_DIR = path.join('observability-output', 'snapshot');
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_PROMETHEUS_URL = 'http://localhost:9090';
const DEFAULT_RULES_PATH = path.join('observability', 'prometheus', 'rules', 'auroraflow.yml');
const DEFAULT_TIMEOUT_MS = 5_000;
const HISTOGRAM_PROMETHEUS_METRICS = [
  `${METRIC_NAMES.testCaseDurationMs}_milliseconds_bucket`,
  `${METRIC_NAMES.pageActionDurationMs}_milliseconds_bucket`,
  `${METRIC_NAMES.redisOperationDurationMs}_milliseconds_bucket`,
] as const;
const CORE_PROMETHEUS_METRICS = [
  METRIC_NAMES.testRunsTotal,
  METRIC_NAMES.testCasesTotal,
  METRIC_NAMES.flakyTestsTotal,
  METRIC_NAMES.retryFailuresTotal,
  METRIC_NAMES.sloAlertBreachesTotal,
  METRIC_NAMES.pageActionsTotal,
  METRIC_NAMES.selfHealingArtifactsTotal,
  METRIC_NAMES.guardedValidationCandidatesTotal,
  METRIC_NAMES.guardedAutoHealTotal,
  METRIC_NAMES.redisOperationsTotal,
  ...HISTOGRAM_PROMETHEUS_METRICS,
] as const;
const KNOWN_AURORAFLOW_PROMETHEUS_METRICS = new Set<string>([
  ...REQUIRED_METRIC_NAMES,
  ...HISTOGRAM_PROMETHEUS_METRICS,
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFlagValue(argv: readonly string[], index: number, flagName: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flagName}.`);
  }
  return value;
}

function parsePositiveInteger(
  rawValue: string | undefined,
  optionName: string,
  fallback: number,
): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 60_000) {
    throw new Error(`${optionName} must be an integer between 1 and 60000.`);
  }
  return parsed;
}

function normalizeHttpUrl(rawValue: string | undefined, fallback: string): string {
  const normalized = rawValue?.trim() || fallback;
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Prometheus URL must use http or https: ${normalized}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Prometheus URL must not include credentials.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

function normalizeOutputPath(rawValue: string | undefined, fallback: string): string {
  const normalized = rawValue?.trim() || fallback;
  if (normalized.includes('\0')) {
    throw new Error('Output paths must not contain NUL bytes.');
  }
  return normalized;
}

export function parseObservabilityLiveExportAssertCliOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ObservabilityLiveExportAssertOptions {
  const cliValues: Record<string, string | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === '--dashboard-dir' ||
      argument === '--max-attempts' ||
      argument === '--output-dir' ||
      argument === '--poll-interval-ms' ||
      argument === '--prometheus-url' ||
      argument === '--rules-path' ||
      argument === '--timeout-ms'
    ) {
      cliValues[argument] = readFlagValue(argv, index, argument);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    dashboardDir: normalizeOutputPath(
      cliValues['--dashboard-dir'] ?? env.AURORAFLOW_OBSERVABILITY_DASHBOARD_DIR,
      DEFAULT_DASHBOARD_DIR,
    ),
    maxAttempts: parsePositiveInteger(
      cliValues['--max-attempts'] ?? env.AURORAFLOW_OBSERVABILITY_LIVE_ASSERT_MAX_ATTEMPTS,
      'max attempts',
      DEFAULT_MAX_ATTEMPTS,
    ),
    outputDir: normalizeOutputPath(
      cliValues['--output-dir'] ??
        env.AURORAFLOW_OBSERVABILITY_LIVE_ASSERT_OUTPUT_DIR ??
        env.AURORAFLOW_OBSERVABILITY_SNAPSHOT_DIR,
      DEFAULT_OUTPUT_DIR,
    ),
    pollIntervalMs: parsePositiveInteger(
      cliValues['--poll-interval-ms'] ?? env.AURORAFLOW_OBSERVABILITY_LIVE_ASSERT_POLL_INTERVAL_MS,
      'poll interval',
      DEFAULT_POLL_INTERVAL_MS,
    ),
    prometheusUrl: normalizeHttpUrl(
      cliValues['--prometheus-url'] ?? env.AURORAFLOW_OBSERVABILITY_PROMETHEUS_URL,
      DEFAULT_PROMETHEUS_URL,
    ),
    rulesPath: normalizeOutputPath(
      cliValues['--rules-path'] ?? env.AURORAFLOW_OBSERVABILITY_RULES_PATH,
      DEFAULT_RULES_PATH,
    ),
    timeoutMs: parsePositiveInteger(
      cliValues['--timeout-ms'] ?? env.AURORAFLOW_OBSERVABILITY_TIMEOUT_MS,
      'timeout',
      DEFAULT_TIMEOUT_MS,
    ),
  };
}

function buildPrometheusUrl(
  prometheusUrl: string,
  pathname: string,
  params: readonly [string, string][],
): string {
  const baseWithSlash = prometheusUrl.endsWith('/') ? prometheusUrl : `${prometheusUrl}/`;
  const url = new URL(pathname.replace(/^\/+/u, ''), baseWithSlash);
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchPrometheusData(
  fetchImpl: FetchFunction,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Prometheus request failed: status=${response.status} url=${url}`);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.status !== 'success') {
      const errorMessage =
        isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'unknown error';
      throw new Error(`Prometheus API returned a non-success response: ${errorMessage}`);
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

function asStringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const result: Record<string, string> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue !== 'string') {
      throw new Error(`${label}.${key} must be a string.`);
    }
    result[key] = nestedValue;
  }
  return result;
}

function parseLabels(data: unknown): readonly string[] {
  if (!Array.isArray(data) || !data.every((label): label is string => typeof label === 'string')) {
    throw new Error('Prometheus labels response must be an array of strings.');
  }
  return [...new Set(data)].sort();
}

function parseSeries(data: unknown): readonly Readonly<Record<string, string>>[] {
  if (!Array.isArray(data)) {
    throw new Error('Prometheus series response must be an array.');
  }
  return data.map((entry, index) => asStringRecord(entry, `series[${index}]`));
}

function parseQuerySeries(data: unknown): readonly Readonly<Record<string, string>>[] {
  if (!isRecord(data) || !Array.isArray(data.result)) {
    throw new Error('Prometheus query response must contain a result array.');
  }
  return data.result.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`query.result[${index}] must be an object.`);
    }
    return asStringRecord(entry.metric, `query.result[${index}].metric`);
  });
}

function parseLoadedAlertNames(data: unknown): readonly string[] {
  if (!isRecord(data) || !Array.isArray(data.groups)) {
    throw new Error('Prometheus rules response must contain groups.');
  }

  const alertNames = new Set<string>();
  for (const group of data.groups) {
    if (!isRecord(group) || !Array.isArray(group.rules)) {
      continue;
    }
    for (const rule of group.rules) {
      if (isRecord(rule) && typeof rule.name === 'string') {
        alertNames.add(rule.name);
      }
    }
  }
  return [...alertNames].sort();
}

function summarizeSeries(
  series: readonly Readonly<Record<string, string>>[],
  queryResultCount: number,
): PrometheusSeriesSnapshot {
  const labelValues = new Map<string, Set<string>>();
  for (const metricLabels of series) {
    for (const [labelName, labelValue] of Object.entries(metricLabels)) {
      if (labelName === '__name__') {
        continue;
      }
      const values = labelValues.get(labelName) ?? new Set<string>();
      values.add(labelValue);
      labelValues.set(labelName, values);
    }
  }

  return {
    labelNames: [...labelValues.keys()].sort(),
    labelValues: Object.fromEntries(
      [...labelValues.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([labelName, values]) => [labelName, [...values].sort()]),
    ) as Readonly<Record<string, readonly string[]>>,
    queryResultCount,
    seriesCount: series.length,
  };
}

async function fetchMetricSnapshot({
  fetchImpl,
  metricName,
  options,
}: {
  readonly fetchImpl: FetchFunction;
  readonly metricName: string;
  readonly options: ObservabilityLiveExportAssertOptions;
}): Promise<PrometheusSeriesSnapshot> {
  const seriesUrl = buildPrometheusUrl(options.prometheusUrl, '/api/v1/series', [
    ['match[]', metricName],
  ]);
  const queryUrl = buildPrometheusUrl(options.prometheusUrl, '/api/v1/query', [
    ['query', metricName],
  ]);
  const [series, querySeries] = await Promise.all([
    fetchPrometheusData(fetchImpl, seriesUrl, options.timeoutMs).then(parseSeries),
    fetchPrometheusData(fetchImpl, queryUrl, options.timeoutMs).then(parseQuerySeries),
  ]);
  return summarizeSeries(series, querySeries.length);
}

async function collectMetricSnapshots({
  fetchImpl,
  metricNames,
  options,
}: {
  readonly fetchImpl: FetchFunction;
  readonly metricNames: readonly string[];
  readonly options: ObservabilityLiveExportAssertOptions;
}): Promise<Readonly<Record<string, PrometheusSeriesSnapshot>>> {
  const entries = await Promise.all(
    metricNames.map(async (metricName) => [
      metricName,
      await fetchMetricSnapshot({ fetchImpl, metricName, options }),
    ]),
  );
  return Object.fromEntries(entries) as Readonly<Record<string, PrometheusSeriesSnapshot>>;
}

async function waitForMetricSnapshots({
  fetchImpl,
  metricNames,
  options,
}: {
  readonly fetchImpl: FetchFunction;
  readonly metricNames: readonly string[];
  readonly options: ObservabilityLiveExportAssertOptions;
}): Promise<Readonly<Record<string, PrometheusSeriesSnapshot>>> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const snapshots = await collectMetricSnapshots({ fetchImpl, metricNames, options });
      const missing = metricNames.filter((metricName) => snapshots[metricName]?.seriesCount === 0);
      if (missing.length === 0) {
        return snapshots;
      }
      lastError = `missing metric series: ${missing.join(', ')}`;
    } catch (error: unknown) {
      lastError = toErrorMessage(error);
    }

    if (attempt < options.maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
    }
  }

  throw new Error(`Prometheus metric scrape did not become ready: ${lastError ?? 'unknown error'}`);
}

function collectDashboardExpressionsFromValue(
  value: unknown,
  source: string,
  expressions: DashboardExpression[],
): void {
  if (Array.isArray(value)) {
    for (const nestedValue of value) {
      collectDashboardExpressionsFromValue(nestedValue, source, expressions);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  if (typeof value.expr === 'string') {
    expressions.push({
      expression: value.expr,
      legendFormat: typeof value.legendFormat === 'string' ? value.legendFormat : undefined,
      source,
    });
  }

  for (const nestedValue of Object.values(value)) {
    collectDashboardExpressionsFromValue(nestedValue, source, expressions);
  }
}

async function readDashboardExpressions(
  dashboardDir: string,
): Promise<readonly DashboardExpression[]> {
  const fileNames = (await readdir(dashboardDir))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort();
  const expressions: DashboardExpression[] = [];

  for (const fileName of fileNames) {
    const source = path.join(dashboardDir, fileName);
    const dashboardPayload: unknown = JSON.parse(await readFile(source, 'utf8'));
    collectDashboardExpressionsFromValue(dashboardPayload, source, expressions);
  }
  return expressions;
}

function readYamlBlockExpression(
  lines: readonly string[],
  startIndex: number,
  baseIndent: number,
): { readonly expression: string; readonly nextIndex: number } {
  const expressionLines: string[] = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (trimmed !== '' && indent <= baseIndent) {
      break;
    }
    expressionLines.push(line.slice(Math.min(line.length, baseIndent + 2)));
  }
  return {
    expression: expressionLines.join('\n').trim(),
    nextIndex: index - 1,
  };
}

function readRuleExpressions(content: string, source: string): readonly DashboardExpression[] {
  const lines = content.split(/\r?\n/u);
  const expressions: DashboardExpression[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)expr:\s*(.*)$/u.exec(lines[index]);
    if (!match) {
      continue;
    }
    const [, indentText, inlineExpression] = match;
    if (inlineExpression.trim() === '|' || inlineExpression.trim() === '>') {
      const block = readYamlBlockExpression(lines, index, indentText.length);
      expressions.push({ expression: block.expression, source });
      index = block.nextIndex;
      continue;
    }
    expressions.push({ expression: inlineExpression.trim(), source });
  }

  return expressions;
}

function readExpectedAlertNames(content: string): readonly string[] {
  const alertNames = new Set<string>();
  const alertPattern = /^\s*-\s*alert:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/gmu;
  for (const match of content.matchAll(alertPattern)) {
    alertNames.add(match[1]);
  }
  return [...alertNames].sort();
}

async function readExpressionsAndAlerts(options: ObservabilityLiveExportAssertOptions): Promise<{
  readonly expectedAlertNames: readonly string[];
  readonly expressions: readonly DashboardExpression[];
}> {
  const [dashboardExpressions, rulesContent] = await Promise.all([
    readDashboardExpressions(options.dashboardDir),
    readFile(options.rulesPath, 'utf8'),
  ]);

  return {
    expectedAlertNames: readExpectedAlertNames(rulesContent),
    expressions: [...dashboardExpressions, ...readRuleExpressions(rulesContent, options.rulesPath)],
  };
}

function extractAuroraFlowMetricNames(expression: string): readonly string[] {
  const metricNames = new Set<string>();
  const tokenPattern = /\bauroraflow_[A-Za-z_:][A-Za-z0-9_:]*\b/gu;
  for (const match of expression.matchAll(tokenPattern)) {
    const token = match[0];
    if (KNOWN_AURORAFLOW_PROMETHEUS_METRICS.has(token)) {
      metricNames.add(token);
    } else if (/(?:_total|_bucket|_sum|_count)$/u.test(token)) {
      throw new Error(`Unknown AuroraFlow Prometheus metric in expression: ${token}`);
    }
  }
  return [...metricNames].sort();
}

function extractLabelMatchers(expression: string): readonly PrometheusLabelMatcher[] {
  const matchers: PrometheusLabelMatcher[] = [];
  const matcherPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(=|!=|=~|!~)\s*"((?:\\.|[^"\\])*)"/gu;
  for (const match of expression.matchAll(matcherPattern)) {
    matchers.push({
      labelName: match[1],
      operator: match[2] as PrometheusLabelMatcher['operator'],
      value: match[3].replace(/\\"/gu, '"'),
    });
  }
  return matchers;
}

function extractGroupLabels(expression: string): readonly string[] {
  const labels = new Set<string>();
  const groupPattern = /\b(?:by|without)\s*\(([^)]*)\)/gu;
  for (const match of expression.matchAll(groupPattern)) {
    for (const labelName of match[1].split(',').map((value) => value.trim())) {
      if (labelName) {
        labels.add(labelName);
      }
    }
  }
  return [...labels].sort();
}

function extractLegendLabels(legendFormat: string | undefined): readonly string[] {
  if (legendFormat === undefined) {
    return [];
  }
  const labels = new Set<string>();
  const legendPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;
  for (const match of legendFormat.matchAll(legendPattern)) {
    labels.add(match[1]);
  }
  return [...labels].sort();
}

function hasLabelValue(
  metrics: readonly string[],
  snapshots: Readonly<Record<string, PrometheusSeriesSnapshot>>,
  labelName: string,
  labelValue: string,
): boolean {
  return metrics.some((metricName) =>
    snapshots[metricName]?.labelValues[labelName]?.includes(labelValue),
  );
}

function validateExpressionsAgainstSeries({
  expressions,
  snapshots,
}: {
  readonly expressions: readonly DashboardExpression[];
  readonly snapshots: Readonly<Record<string, PrometheusSeriesSnapshot>>;
}): void {
  const errors: string[] = [];

  for (const expression of expressions) {
    const metricNames = extractAuroraFlowMetricNames(expression.expression);
    if (metricNames.length === 0) {
      continue;
    }

    const availableLabels = new Set<string>(
      metricNames.flatMap((metricName) => snapshots[metricName]?.labelNames ?? []),
    );
    const labelMatchers = extractLabelMatchers(expression.expression);
    const referencedLabels = new Set<string>([
      ...labelMatchers.map((matcher) => matcher.labelName),
      ...extractGroupLabels(expression.expression),
      ...extractLegendLabels(expression.legendFormat),
    ]);

    for (const labelName of referencedLabels) {
      if (!availableLabels.has(labelName)) {
        errors.push(`${expression.source}: unknown Prometheus label "${labelName}" in expression.`);
      }
    }

    for (const matcher of labelMatchers) {
      if (
        matcher.operator === '=' &&
        matcher.value !== '' &&
        availableLabels.has(matcher.labelName) &&
        !hasLabelValue(metricNames, snapshots, matcher.labelName, matcher.value)
      ) {
        errors.push(
          `${expression.source}: label "${matcher.labelName}" never exported value "${matcher.value}".`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Prometheus dashboard/rule validation failed:\n${errors.join('\n')}`);
  }
}

export async function runObservabilityLiveExportAssert(
  options: ObservabilityLiveExportAssertOptions,
  fetchImpl: FetchFunction = globalThis.fetch,
): Promise<PrometheusLabelSnapshot> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for live export assertions.');
  }

  const { expectedAlertNames, expressions } = await readExpressionsAndAlerts(options);
  const expressionMetricNames = expressions.flatMap((expression) =>
    extractAuroraFlowMetricNames(expression.expression),
  );
  const metricNames = [...new Set([...CORE_PROMETHEUS_METRICS, ...expressionMetricNames])].sort();
  const metrics = await waitForMetricSnapshots({ fetchImpl, metricNames, options });

  validateExpressionsAgainstSeries({ expressions, snapshots: metrics });

  const [labels, loadedAlertNames] = await Promise.all([
    fetchPrometheusData(
      fetchImpl,
      buildPrometheusUrl(options.prometheusUrl, '/api/v1/labels', []),
      options.timeoutMs,
    ).then(parseLabels),
    fetchPrometheusData(
      fetchImpl,
      buildPrometheusUrl(options.prometheusUrl, '/api/v1/rules', []),
      options.timeoutMs,
    ).then(parseLoadedAlertNames),
  ]);

  const missingAlertNames = expectedAlertNames.filter(
    (alertName) => !loadedAlertNames.includes(alertName),
  );
  if (missingAlertNames.length > 0) {
    throw new Error(`Prometheus did not load alert rule(s): ${missingAlertNames.join(', ')}`);
  }

  const snapshot: PrometheusLabelSnapshot = {
    dashboardChecks: {
      expressionCount: expressions.length,
      sources: [...new Set(expressions.map((expression) => expression.source))].sort(),
    },
    generatedAt: new Date().toISOString(),
    metrics,
    prometheus: {
      labelCount: labels.length,
      labels,
      rules: {
        expectedAlertNames,
        loadedAlertNames,
      },
      url: options.prometheusUrl,
    },
    schemaVersion: 1,
  };

  await mkdir(options.outputDir, { recursive: true });
  await writeFile(
    path.join(options.outputDir, 'observability-label-snapshot.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  return snapshot;
}

async function main(): Promise<number> {
  const options = parseObservabilityLiveExportAssertCliOptions(process.argv.slice(2));
  const snapshot = await runObservabilityLiveExportAssert(options);
  console.log(
    `Prometheus labels validated: metrics=${Object.keys(snapshot.metrics).length} labels=${snapshot.prometheus.labelCount} output=${path.join(
      options.outputDir,
      'observability-label-snapshot.json',
    )}`,
  );
  return 0;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error: unknown) => {
      console.error(`Observability live export assertion failed: ${toErrorMessage(error)}`);
      process.exit(1);
    });
}
