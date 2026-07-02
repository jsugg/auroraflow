import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { SPAN_NAMES } from '../src/framework/observability/attributes';
import { METRIC_NAMES } from '../src/framework/observability/metricNames';

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface CollectorReceiptEvidence {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly expected: {
    readonly logMarker: string;
    readonly metricName: string;
    readonly spanName: string;
  };
  readonly observed: {
    readonly logMarker: boolean;
    readonly metricName: boolean;
    readonly metricNames: readonly string[];
    readonly spanName: boolean;
  };
  readonly failures: readonly string[];
}

export interface CollectorReceiptInput {
  readonly collectorLogText: string;
  readonly generatedAt?: string;
  readonly metricsText: string;
  readonly runId?: string;
}

export interface EmitCollectorReceiptLogOptions {
  readonly endpoint: string;
  readonly marker: string;
  readonly timeoutMs?: number;
}

export interface CollectorReceiptCliOptions {
  readonly collectorLogPath: string;
  readonly metricsPath: string;
  readonly outputDir: string;
  readonly runId?: string;
}

const COLLECTOR_RECEIPT_LOG_PREFIX = 'auroraflow.observability.collector-receipt.v1';
const DEFAULT_COLLECTOR_LOG_PATH = path.join('observability-output', 'ci', 'collector.log');
const DEFAULT_METRICS_PATH = path.join('observability-output', 'ci', 'collector-metrics.txt');
const DEFAULT_OUTPUT_DIR = path.join('observability-output', 'ci');
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const PROMETHEUS_SAMPLE_PATTERN = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{[^}]*\})?\s/u;

function normalizeRunId(runId: string | undefined): string {
  const normalized = runId?.trim() || 'local';
  if (!RUN_ID_PATTERN.test(normalized)) {
    throw new Error(
      'Collector receipt run id must contain 1-128 letters, digits, dots, underscores, or hyphens.',
    );
  }
  return normalized;
}

function normalizePath(rawValue: string | undefined, fallback: string): string {
  const normalized = rawValue?.trim() || fallback;
  if (normalized.includes('\0')) {
    throw new Error('Collector receipt paths must not contain NUL bytes.');
  }
  return normalized;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  const normalized = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_TIMEOUT_MS) {
    throw new Error(
      `Collector receipt timeout must be an integer between 1 and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return normalized;
}

function buildLogsEndpoint(rawEndpoint: string): string {
  const endpoint = new URL(rawEndpoint.trim());
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error(`OTLP endpoint must use http or https: ${rawEndpoint}`);
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('OTLP endpoint must not contain credentials.');
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, '')}/v1/logs`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

function collectPrometheusMetricNames(metricsText: string): readonly string[] {
  const names = new Set<string>();
  for (const line of metricsText.split(/\r?\n/u)) {
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }
    const match = PROMETHEUS_SAMPLE_PATTERN.exec(line);
    if (match?.[1]) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

/** Builds the run-scoped marker expected in Collector log output. */
export function buildCollectorReceiptLogMarker(runId?: string): string {
  return `${COLLECTOR_RECEIPT_LOG_PREFIX}:${normalizeRunId(runId)}`;
}

/** Builds a standards-compliant OTLP/HTTP JSON log request. */
export function createCollectorReceiptOtlpPayload(
  marker: string,
  timeUnixNano: string = (BigInt(Date.now()) * 1_000_000n).toString(),
): Readonly<Record<string, unknown>> {
  if (marker.trim() === '') {
    throw new Error('Collector receipt log marker must not be empty.');
  }
  if (!/^\d+$/u.test(timeUnixNano)) {
    throw new Error('OTLP log timeUnixNano must be a decimal integer string.');
  }

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'auroraflow' } },
            { key: 'deployment.environment', value: { stringValue: 'ci' } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'auroraflow.observability-ci' },
            logRecords: [
              {
                timeUnixNano,
                observedTimeUnixNano: timeUnixNano,
                severityNumber: 9,
                severityText: 'INFO',
                body: { stringValue: marker },
                attributes: [
                  { key: 'auroraflow.ci.smoke', value: { boolValue: true } },
                  { key: 'auroraflow.receipt.marker', value: { stringValue: marker } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Emits the receipt marker through the configured OTLP/HTTP logs endpoint. */
export async function emitCollectorReceiptLog(
  options: EmitCollectorReceiptLogOptions,
  fetchImpl: FetchFunction = globalThis.fetch,
): Promise<void> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to emit the Collector receipt log.');
  }
  const endpoint = buildLogsEndpoint(options.endpoint);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createCollectorReceiptOtlpPayload(options.marker)),
    signal: AbortSignal.timeout(normalizeTimeout(options.timeoutMs)),
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(
      `Collector rejected OTLP log receipt at ${endpoint}: HTTP ${response.status}${detail ? ` (${detail})` : ''}.`,
    );
  }
}

/** Evaluates metric, span, and log receipt from captured Collector evidence. */
export function evaluateCollectorReceipt(input: CollectorReceiptInput): CollectorReceiptEvidence {
  const expected = {
    logMarker: buildCollectorReceiptLogMarker(input.runId),
    metricName: METRIC_NAMES.testRunsTotal,
    spanName: SPAN_NAMES.testRun,
  };
  const metricNames = collectPrometheusMetricNames(input.metricsText);
  const observed = {
    logMarker: input.collectorLogText.includes(expected.logMarker),
    metricName: metricNames.includes(expected.metricName),
    metricNames,
    spanName: input.collectorLogText.includes(expected.spanName),
  };
  const failures = [
    ...(observed.metricName ? [] : [`missing metric ${expected.metricName}`]),
    ...(observed.spanName ? [] : [`missing span ${expected.spanName}`]),
    ...(observed.logMarker ? [] : [`missing log marker ${expected.logMarker}`]),
  ];

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    passed: failures.length === 0,
    expected,
    observed,
    failures,
  };
}

/** Parses Collector receipt CLI paths and run identity. */
export function parseCollectorReceiptCliOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): CollectorReceiptCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument !== '--collector-log-path' &&
      argument !== '--metrics-path' &&
      argument !== '--output-dir' &&
      argument !== '--run-id'
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`${argument} may be supplied only once.`);
    }
    values.set(argument, readFlagValue(argv, index, argument));
    index += 1;
  }

  return {
    collectorLogPath: normalizePath(values.get('--collector-log-path'), DEFAULT_COLLECTOR_LOG_PATH),
    metricsPath: normalizePath(values.get('--metrics-path'), DEFAULT_METRICS_PATH),
    outputDir: normalizePath(values.get('--output-dir'), DEFAULT_OUTPUT_DIR),
    runId: values.get('--run-id') ?? env.GITHUB_RUN_ID,
  };
}

/** Reads captured evidence, writes a receipt, and fails closed when any signal is missing. */
export async function runCollectorReceiptAssert(
  options: CollectorReceiptCliOptions,
): Promise<CollectorReceiptEvidence> {
  const [collectorLogText, metricsText] = await Promise.all([
    readFile(options.collectorLogPath, 'utf8'),
    readFile(options.metricsPath, 'utf8'),
  ]);
  const evidence = evaluateCollectorReceipt({
    collectorLogText,
    metricsText,
    runId: options.runId,
  });
  await mkdir(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, 'collector-receipt.json');
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!evidence.passed) {
    throw new Error(
      `Collector receipt assertion failed: ${evidence.failures.join('; ')}. Evidence: ${outputPath}`,
    );
  }
  return evidence;
}

async function main(): Promise<void> {
  const evidence = await runCollectorReceiptAssert(
    parseCollectorReceiptCliOptions(process.argv.slice(2)),
  );
  console.log(
    `Collector receipt validated: metric=${evidence.expected.metricName} span=${evidence.expected.spanName} log=${evidence.expected.logMarker}`,
  );
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `Collector receipt assertion failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
