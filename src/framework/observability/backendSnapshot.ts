import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ObservabilitySnapshotEndpoints {
  readonly elasticsearchUrl: string;
  readonly grafanaUrl: string;
  readonly jaegerUrl: string;
  readonly kibanaUrl: string;
  readonly prometheusUrl: string;
}

export interface ObservabilitySnapshotOptions extends ObservabilitySnapshotEndpoints {
  readonly allowPartial: boolean;
  readonly outputDir: string;
  readonly timeoutMs: number;
}

export interface ObservabilitySnapshotTarget {
  readonly backend: keyof ObservabilitySnapshotEndpoints;
  readonly fileName: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly url: string;
}

export interface ObservabilitySnapshotFileResult {
  readonly fileName: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly url: string;
  readonly error?: string;
}

export interface ObservabilitySnapshotResult {
  readonly failed: number;
  readonly outputDir: string;
  readonly succeeded: number;
  readonly targets: readonly ObservabilitySnapshotFileResult[];
}

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_OUTPUT_DIR = path.join('observability-output', 'snapshot');
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;

export const DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS: ObservabilitySnapshotOptions = {
  allowPartial: false,
  elasticsearchUrl: 'http://localhost:9200',
  grafanaUrl: 'http://localhost:3000',
  jaegerUrl: 'http://localhost:16686',
  kibanaUrl: 'http://localhost:5601',
  outputDir: DEFAULT_OUTPUT_DIR,
  prometheusUrl: 'http://localhost:9090',
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

function normalizeOutputDir(rawValue: string | undefined): string {
  const normalized = rawValue?.trim() || DEFAULT_OUTPUT_DIR;
  if (normalized.includes('\0')) {
    throw new Error('Snapshot output directory must not contain NUL bytes.');
  }
  return normalized;
}

function parseTimeout(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`Snapshot timeout must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

function normalizeBaseUrl(rawValue: string | undefined, fallback: string): string {
  const normalized = rawValue?.trim() || fallback;
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Snapshot endpoint must use http or https: ${normalized}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Snapshot endpoints must not include credentials in URLs.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

function appendPath(baseUrl: string, suffix: string): string {
  const baseWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(suffix.replace(/^\/+/u, ''), baseWithSlash).toString();
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (['1', 'true', 'yes'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(normalized)) {
    return false;
  }
  throw new Error('Boolean snapshot flags must be one of true, false, 1, 0, yes, or no.');
}

export function parseObservabilitySnapshotCliOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ObservabilitySnapshotOptions {
  const cliValues: Record<string, string | undefined> = {};
  let allowPartial = parseBooleanFlag(env.AURORAFLOW_OBSERVABILITY_SNAPSHOT_ALLOW_PARTIAL);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--allow-partial') {
      allowPartial = true;
      continue;
    }

    if (
      argument === '--output-dir' ||
      argument === '--timeout-ms' ||
      argument === '--prometheus-url' ||
      argument === '--grafana-url' ||
      argument === '--jaeger-url' ||
      argument === '--elasticsearch-url' ||
      argument === '--kibana-url'
    ) {
      if (!value) {
        throw new Error(`Missing value for ${argument}.`);
      }
      cliValues[argument] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    allowPartial,
    elasticsearchUrl: normalizeBaseUrl(
      cliValues['--elasticsearch-url'] ?? env.AURORAFLOW_OBSERVABILITY_ELASTICSEARCH_URL,
      DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS.elasticsearchUrl,
    ),
    grafanaUrl: normalizeBaseUrl(
      cliValues['--grafana-url'] ?? env.AURORAFLOW_OBSERVABILITY_GRAFANA_URL,
      DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS.grafanaUrl,
    ),
    jaegerUrl: normalizeBaseUrl(
      cliValues['--jaeger-url'] ?? env.AURORAFLOW_OBSERVABILITY_JAEGER_URL,
      DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS.jaegerUrl,
    ),
    kibanaUrl: normalizeBaseUrl(
      cliValues['--kibana-url'] ?? env.AURORAFLOW_OBSERVABILITY_KIBANA_URL,
      DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS.kibanaUrl,
    ),
    outputDir: normalizeOutputDir(
      cliValues['--output-dir'] ?? env.AURORAFLOW_OBSERVABILITY_SNAPSHOT_DIR,
    ),
    prometheusUrl: normalizeBaseUrl(
      cliValues['--prometheus-url'] ?? env.AURORAFLOW_OBSERVABILITY_PROMETHEUS_URL,
      DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS.prometheusUrl,
    ),
    timeoutMs: parseTimeout(cliValues['--timeout-ms'] ?? env.AURORAFLOW_OBSERVABILITY_TIMEOUT_MS),
  };
}

export function buildObservabilitySnapshotTargets(
  options: ObservabilitySnapshotOptions,
): readonly ObservabilitySnapshotTarget[] {
  return [
    {
      backend: 'prometheusUrl',
      fileName: 'prometheus-targets.json',
      url: appendPath(options.prometheusUrl, '/api/v1/targets'),
    },
    {
      backend: 'prometheusUrl',
      fileName: 'prometheus-auroraflow-test-runs.json',
      url: appendPath(
        options.prometheusUrl,
        `/api/v1/query?query=${encodeURIComponent('auroraflow_test_runs_total')}`,
      ),
    },
    {
      backend: 'grafanaUrl',
      fileName: 'grafana-health.json',
      url: appendPath(options.grafanaUrl, '/api/health'),
    },
    {
      backend: 'grafanaUrl',
      fileName: 'grafana-datasources.json',
      url: appendPath(options.grafanaUrl, '/api/datasources'),
    },
    {
      backend: 'jaegerUrl',
      fileName: 'jaeger-traces.json',
      url: appendPath(options.jaegerUrl, '/api/traces?service=auroraflow&limit=20'),
    },
    {
      backend: 'elasticsearchUrl',
      fileName: 'elasticsearch-health.json',
      url: appendPath(options.elasticsearchUrl, '/_cluster/health'),
    },
    {
      backend: 'elasticsearchUrl',
      fileName: 'elasticsearch-indices.json',
      url: appendPath(options.elasticsearchUrl, '/_cat/indices/auroraflow-*?format=json'),
    },
    {
      backend: 'kibanaUrl',
      fileName: 'kibana-status.json',
      url: appendPath(options.kibanaUrl, '/api/status'),
    },
    {
      backend: 'kibanaUrl',
      fileName: 'kibana-data-views.json',
      headers: { 'kbn-xsrf': 'auroraflow' },
      url: appendPath(
        options.kibanaUrl,
        '/api/saved_objects/_find?type=index-pattern&search_fields=title&search=auroraflow*',
      ),
    },
  ];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectTargetSnapshot({
  fetchImpl,
  outputDir,
  target,
  timeoutMs,
}: {
  readonly fetchImpl: FetchFunction;
  readonly outputDir: string;
  readonly target: ObservabilitySnapshotTarget;
  readonly timeoutMs: number;
}): Promise<ObservabilitySnapshotFileResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const outputPath = path.join(outputDir, target.fileName);

  try {
    const response = await fetchImpl(target.url, {
      headers: target.headers,
      signal: controller.signal,
    });
    const body = await response.text();
    await writeFile(outputPath, body.endsWith('\n') ? body : `${body}\n`, 'utf8');

    return {
      fileName: target.fileName,
      ok: response.ok,
      status: response.status,
      url: target.url,
    };
  } catch (error: unknown) {
    const errorMessage = toErrorMessage(error);
    await writeFile(
      outputPath,
      `${JSON.stringify({ ok: false, error: errorMessage, url: target.url }, null, 2)}\n`,
      'utf8',
    );
    return {
      error: errorMessage,
      fileName: target.fileName,
      ok: false,
      url: target.url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectObservabilitySnapshot(
  options: ObservabilitySnapshotOptions,
  fetchImpl: FetchFunction = globalThis.fetch,
): Promise<ObservabilitySnapshotResult> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to collect observability snapshots.');
  }

  await mkdir(options.outputDir, { recursive: true });
  const targets = buildObservabilitySnapshotTargets(options);
  const results = await Promise.all(
    targets.map((target) =>
      collectTargetSnapshot({
        fetchImpl,
        outputDir: options.outputDir,
        target,
        timeoutMs: options.timeoutMs,
      }),
    ),
  );
  const failed = results.filter((result) => !result.ok).length;
  const snapshotResult: ObservabilitySnapshotResult = {
    failed,
    outputDir: options.outputDir,
    succeeded: results.length - failed,
    targets: results,
  };

  await writeFile(
    path.join(options.outputDir, 'manifest.json'),
    `${JSON.stringify(snapshotResult, null, 2)}\n`,
    'utf8',
  );

  if (failed > 0 && !options.allowPartial) {
    throw new Error(`Observability snapshot failed for ${failed} target(s).`);
  }

  return snapshotResult;
}
