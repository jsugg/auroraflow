import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseObservabilitySnapshotCliOptions,
  type ObservabilitySnapshotEndpoints,
} from './backendSnapshot';

export const OBSERVABILITY_BACKEND_VALIDATION_SCHEMA_VERSION = '1.0.0' as const;

export type ObservabilityBackendValidationMode = 'readiness' | 'smoke';
export type ObservabilityBackend =
  | 'collector'
  | 'prometheus'
  | 'grafana'
  | 'jaeger'
  | 'elasticsearch'
  | 'kibana';
export type ObservabilityBackendCheckStatus = 'passed' | 'failed';
export type ObservabilityBackendValidationStatus = 'passed' | 'failed';

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;
type SleepFunction = (milliseconds: number) => Promise<void>;
type DiagnosticValue = string | number | boolean | readonly string[];

export interface ObservabilityBackendValidationOptions extends ObservabilitySnapshotEndpoints {
  readonly collectorUrl: string;
  readonly maxAttempts: number;
  readonly mode: ObservabilityBackendValidationMode;
  readonly outputDir: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

export interface ObservabilityBackendCheckDiagnostic {
  readonly attempts: number;
  readonly backend: ObservabilityBackend;
  readonly checkId: string;
  readonly evidence?: Readonly<Record<string, DiagnosticValue>>;
  readonly message: string;
  readonly status: ObservabilityBackendCheckStatus;
  readonly url: string;
}

export interface ObservabilityBackendValidationResult {
  readonly checks: readonly ObservabilityBackendCheckDiagnostic[];
  readonly generatedAt: string;
  readonly mode: ObservabilityBackendValidationMode;
  readonly schemaVersion: typeof OBSERVABILITY_BACKEND_VALIDATION_SCHEMA_VERSION;
  readonly status: ObservabilityBackendValidationStatus;
  readonly summary: {
    readonly failed: number;
    readonly passed: number;
    readonly total: number;
  };
}

export interface ObservabilityBackendValidationDependencies {
  readonly fetchImpl?: FetchFunction;
  readonly now?: () => Date;
  readonly sleep?: SleepFunction;
}

interface CheckSuccess {
  readonly evidence: Readonly<Record<string, DiagnosticValue>>;
  readonly message: string;
}

interface BackendCheck {
  readonly backend: ObservabilityBackend;
  readonly checkId: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly responseType: 'http' | 'json';
  readonly url: string;
  readonly validate: (payload: unknown) => CheckSuccess;
}

const DEFAULT_COLLECTOR_URL = 'http://127.0.0.1:13133';
const DEFAULT_MAX_ATTEMPTS = 30;
const DEFAULT_OUTPUT_DIR = path.join('observability-output', 'validation');
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS = 300;
const MAX_POLL_INTERVAL_MS = 60_000;
const SNAPSHOT_VALUE_FLAGS = new Set([
  '--elasticsearch-url',
  '--grafana-url',
  '--jaeger-url',
  '--kibana-url',
  '--output-dir',
  '--prometheus-url',
  '--timeout-ms',
]);
const VALIDATION_ENDPOINT_DEFAULTS = [
  {
    envName: 'AURORAFLOW_OBSERVABILITY_PROMETHEUS_URL',
    flag: '--prometheus-url',
    value: 'http://127.0.0.1:9090',
  },
  {
    envName: 'AURORAFLOW_OBSERVABILITY_GRAFANA_URL',
    flag: '--grafana-url',
    value: 'http://127.0.0.1:3000',
  },
  {
    envName: 'AURORAFLOW_OBSERVABILITY_JAEGER_URL',
    flag: '--jaeger-url',
    value: 'http://127.0.0.1:16686',
  },
  {
    envName: 'AURORAFLOW_OBSERVABILITY_ELASTICSEARCH_URL',
    flag: '--elasticsearch-url',
    value: 'http://127.0.0.1:9200',
  },
  {
    envName: 'AURORAFLOW_OBSERVABILITY_KIBANA_URL',
    flag: '--kibana-url',
    value: 'http://127.0.0.1:5601',
  },
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${context} must be a JSON object.`);
  }
  return value;
}

function asArray(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be a JSON array.`);
  }
  return value;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return value;
}

function appendPath(baseUrl: string, suffix: string): string {
  const baseWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(suffix.replace(/^\/+/, ''), baseWithSlash).toString();
}

function normalizeHttpUrl(rawValue: string | undefined, fallback: string): string {
  const normalized = rawValue?.trim() || fallback;
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Observability validation endpoint must use http or https: ${normalized}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Observability validation endpoints must not include credentials in URLs.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

function parseValidationMode(rawValue: string | undefined): ObservabilityBackendValidationMode {
  const normalized = rawValue?.trim() || 'smoke';
  if (normalized === 'readiness' || normalized === 'smoke') {
    return normalized;
  }
  throw new Error('Observability validation mode must be readiness or smoke.');
}

function parsePositiveInteger({
  rawValue,
  fallback,
  maximum,
  name,
}: {
  readonly rawValue: string | undefined;
  readonly fallback: number;
  readonly maximum: number;
  readonly name: string;
}): number {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }
  if (!/^[1-9]\d*$/u.test(rawValue.trim())) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function parseObservabilityBackendValidationCliOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ObservabilityBackendValidationOptions {
  const snapshotArgs: string[] = [];
  let collectorUrl = env.AURORAFLOW_OBSERVABILITY_COLLECTOR_HEALTH_URL;
  let maxAttempts = env.AURORAFLOW_OBSERVABILITY_VALIDATION_MAX_ATTEMPTS;
  let mode = env.AURORAFLOW_OBSERVABILITY_VALIDATION_MODE;
  let outputDir = env.AURORAFLOW_OBSERVABILITY_VALIDATION_DIR ?? DEFAULT_OUTPUT_DIR;
  let pollIntervalMs = env.AURORAFLOW_OBSERVABILITY_VALIDATION_POLL_INTERVAL_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === undefined) {
      continue;
    }
    if (SNAPSHOT_VALUE_FLAGS.has(argument)) {
      if (value === undefined || value.length === 0) {
        throw new Error(`Missing value for ${argument}.`);
      }
      snapshotArgs.push(argument, value);
      if (argument === '--output-dir') {
        outputDir = value;
      }
      index += 1;
      continue;
    }
    if (
      argument === '--collector-url' ||
      argument === '--max-attempts' ||
      argument === '--mode' ||
      argument === '--poll-interval-ms'
    ) {
      if (value === undefined || value.length === 0) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === '--collector-url') {
        collectorUrl = value;
      } else if (argument === '--max-attempts') {
        maxAttempts = value;
      } else if (argument === '--mode') {
        mode = value;
      } else {
        pollIntervalMs = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!snapshotArgs.includes('--output-dir')) {
    snapshotArgs.push('--output-dir', outputDir);
  }
  for (const endpointDefault of VALIDATION_ENDPOINT_DEFAULTS) {
    if (!snapshotArgs.includes(endpointDefault.flag) && !env[endpointDefault.envName]?.trim()) {
      snapshotArgs.push(endpointDefault.flag, endpointDefault.value);
    }
  }
  const snapshotOptions = parseObservabilitySnapshotCliOptions(snapshotArgs, env);

  return {
    collectorUrl: normalizeHttpUrl(collectorUrl, DEFAULT_COLLECTOR_URL),
    elasticsearchUrl: snapshotOptions.elasticsearchUrl,
    grafanaUrl: snapshotOptions.grafanaUrl,
    jaegerUrl: snapshotOptions.jaegerUrl,
    kibanaUrl: snapshotOptions.kibanaUrl,
    maxAttempts: parsePositiveInteger({
      rawValue: maxAttempts,
      fallback: DEFAULT_MAX_ATTEMPTS,
      maximum: MAX_ATTEMPTS,
      name: 'Observability validation max attempts',
    }),
    mode: parseValidationMode(mode),
    outputDir: snapshotOptions.outputDir,
    pollIntervalMs: parsePositiveInteger({
      rawValue: pollIntervalMs,
      fallback: DEFAULT_POLL_INTERVAL_MS,
      maximum: MAX_POLL_INTERVAL_MS,
      name: 'Observability validation poll interval',
    }),
    prometheusUrl: snapshotOptions.prometheusUrl,
    timeoutMs: snapshotOptions.timeoutMs,
  };
}

function validatePrometheusEnvelope(
  payload: unknown,
  context: string,
): Readonly<Record<string, unknown>> {
  const root = asRecord(payload, context);
  if (root.status !== 'success') {
    throw new Error(`${context} returned status ${String(root.status)} instead of success.`);
  }
  return asRecord(root.data, `${context}.data`);
}

function readinessChecks(options: ObservabilityBackendValidationOptions): readonly BackendCheck[] {
  return [
    {
      backend: 'collector',
      checkId: 'collector.health',
      responseType: 'http',
      url: appendPath(options.collectorUrl, '/'),
      validate: () => ({
        evidence: { reachable: true },
        message: 'Collector health endpoint is reachable.',
      }),
    },
    {
      backend: 'prometheus',
      checkId: 'prometheus.readiness',
      responseType: 'json',
      url: appendPath(options.prometheusUrl, '/api/v1/status/buildinfo'),
      validate: (payload) => {
        validatePrometheusEnvelope(payload, 'Prometheus build-info API');
        return { evidence: { apiStatus: 'success' }, message: 'Prometheus API is ready.' };
      },
    },
    {
      backend: 'grafana',
      checkId: 'grafana.readiness',
      responseType: 'json',
      url: appendPath(options.grafanaUrl, '/api/health'),
      validate: (payload) => {
        const database = asString(
          asRecord(payload, 'Grafana health').database,
          'Grafana database status',
        );
        if (database !== 'ok') {
          throw new Error(`Grafana database status is ${database}; expected ok.`);
        }
        return { evidence: { database }, message: 'Grafana API and database are ready.' };
      },
    },
    {
      backend: 'jaeger',
      checkId: 'jaeger.readiness',
      responseType: 'json',
      url: appendPath(options.jaegerUrl, '/api/services'),
      validate: (payload) => {
        const services = asArray(asRecord(payload, 'Jaeger services').data, 'Jaeger services.data');
        return {
          evidence: { serviceCount: services.length },
          message: 'Jaeger query API is ready.',
        };
      },
    },
    {
      backend: 'elasticsearch',
      checkId: 'elasticsearch.readiness',
      responseType: 'json',
      url: appendPath(options.elasticsearchUrl, '/_cluster/health'),
      validate: (payload) => {
        const status = asString(
          asRecord(payload, 'Elasticsearch health').status,
          'Elasticsearch cluster status',
        );
        if (status !== 'green' && status !== 'yellow') {
          throw new Error(`Elasticsearch cluster status is ${status}; expected green or yellow.`);
        }
        return { evidence: { clusterStatus: status }, message: 'Elasticsearch cluster is ready.' };
      },
    },
    {
      backend: 'kibana',
      checkId: 'kibana.readiness',
      responseType: 'json',
      url: appendPath(options.kibanaUrl, '/api/status'),
      validate: (payload) => {
        const status = asRecord(asRecord(payload, 'Kibana status').status, 'Kibana status.status');
        const overall = asRecord(status.overall, 'Kibana status.status.overall');
        const level = asString(overall.level, 'Kibana overall level');
        if (level !== 'available') {
          throw new Error(`Kibana overall level is ${level}; expected available.`);
        }
        return { evidence: { overallLevel: level }, message: 'Kibana API is ready.' };
      },
    },
  ];
}

function smokeChecks(options: ObservabilityBackendValidationOptions): readonly BackendCheck[] {
  return [
    {
      backend: 'prometheus',
      checkId: 'prometheus.collector-target',
      responseType: 'json',
      url: appendPath(options.prometheusUrl, '/api/v1/targets'),
      validate: (payload) => {
        const data = validatePrometheusEnvelope(payload, 'Prometheus targets API');
        const targets = asArray(data.activeTargets, 'Prometheus active targets');
        const collectorTarget = targets.find((target) => {
          if (!isRecord(target) || !isRecord(target.labels)) {
            return false;
          }
          return target.health === 'up' && target.labels.job === 'otel-collector';
        });
        if (collectorTarget === undefined) {
          throw new Error('Prometheus is missing an up target for service otel-collector.');
        }
        return {
          evidence: { activeTargetCount: targets.length, service: 'otel-collector' },
          message: 'Prometheus reports the otel-collector target as up.',
        };
      },
    },
    {
      backend: 'prometheus',
      checkId: 'prometheus.test-runs-series',
      responseType: 'json',
      url: appendPath(
        options.prometheusUrl,
        `/api/v1/query?query=${encodeURIComponent('auroraflow_test_runs_total')}`,
      ),
      validate: (payload) => {
        const data = validatePrometheusEnvelope(payload, 'Prometheus test-run query');
        const series = asArray(data.result, 'Prometheus test-run query result');
        if (series.length === 0) {
          throw new Error('Prometheus query is missing series auroraflow_test_runs_total.');
        }
        return {
          evidence: { metric: 'auroraflow_test_runs_total', seriesCount: series.length },
          message: 'Prometheus contains auroraflow_test_runs_total series.',
        };
      },
    },
    {
      backend: 'grafana',
      checkId: 'grafana.datasources',
      responseType: 'json',
      url: appendPath(options.grafanaUrl, '/api/datasources'),
      validate: (payload) => {
        const datasources = asArray(payload, 'Grafana data sources');
        const configuredTypes = new Set(
          datasources.flatMap((datasource) => {
            if (!isRecord(datasource) || typeof datasource.type !== 'string') {
              return [];
            }
            return [datasource.type];
          }),
        );
        const requiredTypes = ['prometheus', 'elasticsearch', 'jaeger'] as const;
        const missingTypes = requiredTypes.filter((type) => !configuredTypes.has(type));
        if (missingTypes.length > 0) {
          throw new Error(`Grafana is missing data source types: ${missingTypes.join(', ')}.`);
        }
        return {
          evidence: { dataSourceTypes: [...configuredTypes].sort() },
          message: 'Grafana has Prometheus, Elasticsearch, and Jaeger data sources.',
        };
      },
    },
    {
      backend: 'jaeger',
      checkId: 'jaeger.auroraflow-trace',
      responseType: 'json',
      url: appendPath(options.jaegerUrl, '/api/traces?service=auroraflow&limit=20'),
      validate: (payload) => {
        const traces = asArray(asRecord(payload, 'Jaeger traces').data, 'Jaeger traces.data');
        const traceIds = traces.flatMap((trace) => {
          if (!isRecord(trace) || typeof trace.traceID !== 'string' || trace.traceID.length === 0) {
            return [];
          }
          return [trace.traceID];
        });
        if (traceIds.length === 0) {
          throw new Error('Jaeger is missing a traceID for service auroraflow.');
        }
        return {
          evidence: { service: 'auroraflow', traceCount: traceIds.length },
          message: 'Jaeger contains an AuroraFlow trace.',
        };
      },
    },
    {
      backend: 'elasticsearch',
      checkId: 'elasticsearch.auroraflow-log-index',
      responseType: 'json',
      url: appendPath(options.elasticsearchUrl, '/_cat/indices/auroraflow-*?format=json'),
      validate: (payload) => {
        const indices = asArray(payload, 'Elasticsearch indices');
        const indexNames = indices.flatMap((index) => {
          if (!isRecord(index) || typeof index.index !== 'string') {
            return [];
          }
          return [index.index];
        });
        if (!indexNames.some((indexName) => indexName.startsWith('auroraflow-logs-'))) {
          throw new Error('Elasticsearch is missing index prefix auroraflow-logs-.');
        }
        return {
          evidence: { indexCount: indexNames.length, indices: indexNames.sort() },
          message: 'Elasticsearch contains an AuroraFlow log index.',
        };
      },
    },
    {
      backend: 'kibana',
      checkId: 'kibana.auroraflow-log-view',
      headers: { 'kbn-xsrf': 'auroraflow' },
      responseType: 'json',
      url: appendPath(
        options.kibanaUrl,
        '/api/saved_objects/_find?type=index-pattern&search_fields=title&search=auroraflow*',
      ),
      validate: (payload) => {
        const savedObjects = asArray(
          asRecord(payload, 'Kibana saved objects').saved_objects,
          'Kibana saved_objects',
        );
        const titles = savedObjects.flatMap((savedObject) => {
          if (!isRecord(savedObject) || !isRecord(savedObject.attributes)) {
            return [];
          }
          return typeof savedObject.attributes.title === 'string'
            ? [savedObject.attributes.title]
            : [];
        });
        if (!titles.includes('auroraflow-logs-*')) {
          throw new Error('Kibana is missing data view auroraflow-logs-*.');
        }
        return {
          evidence: { dataViews: titles.sort() },
          message: 'Kibana contains the AuroraFlow log data view.',
        };
      },
    },
  ];
}

export function buildObservabilityBackendChecks(
  options: ObservabilityBackendValidationOptions,
): readonly BackendCheck[] {
  const readiness = readinessChecks(options);
  return options.mode === 'readiness' ? readiness : [...readiness, ...smokeChecks(options)];
}

function toErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = (error as Error & { readonly cause?: unknown }).cause;
  if (cause === undefined || cause === error) {
    return error.message;
  }
  return `${error.message}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

async function fetchCheckPayload({
  check,
  fetchImpl,
  timeoutMs,
}: {
  readonly check: BackendCheck;
  readonly fetchImpl: FetchFunction;
  readonly timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(check.url, {
      headers: check.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${check.backend} check ${check.checkId} returned HTTP ${response.status}.`);
    }
    if (check.responseType === 'http') {
      return undefined;
    }
    const body = await response.text();
    try {
      return JSON.parse(body) as unknown;
    } catch (error: unknown) {
      throw new Error(
        `${check.backend} check ${check.checkId} returned invalid JSON: ${toErrorMessage(error)}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function runBackendCheck({
  check,
  fetchImpl,
  maxAttempts,
  pollIntervalMs,
  sleep,
  timeoutMs,
}: {
  readonly check: BackendCheck;
  readonly fetchImpl: FetchFunction;
  readonly maxAttempts: number;
  readonly pollIntervalMs: number;
  readonly sleep: SleepFunction;
  readonly timeoutMs: number;
}): Promise<ObservabilityBackendCheckDiagnostic> {
  let lastError = 'Check did not run.';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await fetchCheckPayload({ check, fetchImpl, timeoutMs });
      const success = check.validate(payload);
      return {
        attempts: attempt,
        backend: check.backend,
        checkId: check.checkId,
        evidence: success.evidence,
        message: success.message,
        status: 'passed',
        url: check.url,
      };
    } catch (error: unknown) {
      lastError = toErrorMessage(error);
      if (attempt < maxAttempts) {
        await sleep(pollIntervalMs);
      }
    }
  }

  return {
    attempts: maxAttempts,
    backend: check.backend,
    checkId: check.checkId,
    message: lastError,
    status: 'failed',
    url: check.url,
  };
}

function diagnosticsFileName(mode: ObservabilityBackendValidationMode): string {
  return mode === 'readiness'
    ? 'observability-backend-readiness.json'
    : 'observability-backend-validation.json';
}

export async function runObservabilityBackendValidation(
  options: ObservabilityBackendValidationOptions,
  dependencies: ObservabilityBackendValidationDependencies = {},
): Promise<ObservabilityBackendValidationResult> {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for observability backend validation.');
  }
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? (() => new Date());
  const checks = buildObservabilityBackendChecks(options);

  await mkdir(options.outputDir, { recursive: true });
  const diagnostics = await Promise.all(
    checks.map((check) =>
      runBackendCheck({
        check,
        fetchImpl,
        maxAttempts: options.maxAttempts,
        pollIntervalMs: options.pollIntervalMs,
        sleep,
        timeoutMs: options.timeoutMs,
      }),
    ),
  );
  const failed = diagnostics.filter((diagnostic) => diagnostic.status === 'failed').length;
  const result: ObservabilityBackendValidationResult = {
    checks: diagnostics,
    generatedAt: now().toISOString(),
    mode: options.mode,
    schemaVersion: OBSERVABILITY_BACKEND_VALIDATION_SCHEMA_VERSION,
    status: failed === 0 ? 'passed' : 'failed',
    summary: {
      failed,
      passed: diagnostics.length - failed,
      total: diagnostics.length,
    },
  };

  await writeFile(
    path.join(options.outputDir, diagnosticsFileName(options.mode)),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  return result;
}
