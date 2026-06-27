import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import type { TelemetryDiagnosticLogger } from '../../../../../src/framework/observability/telemetry';
import type { TelemetryRuntimeConfig } from '../../../../../src/framework/observability/telemetryConfig';
import type * as OtelModule from '../../../../../src/framework/observability/otelTelemetry';

type DiagnosticLogMethod = (message: string, metadata?: Readonly<Record<string, unknown>>) => void;

/**
 * The OpenTelemetry adapter was at 0% line coverage. These tests mock
 * the OTel SDK/API so the adapter's construction, span lifecycle, metric guards,
 * caching, log correlation, and shutdown error handling are exercised
 * deterministically in node, without a live collector.
 *
 * The mock implementations are re-armed in `beforeEach` so the suite stays robust
 * under the shared `--no-isolate` pool (other specs call `vi.restoreAllMocks()`
 * and the config enables `clearMocks`).
 */

interface FakeSpan {
  setAttribute: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const otel = vi.hoisted(() => {
  const state = {
    spans: [] as FakeSpan[],
    startActiveSpanOptions: [] as unknown[],
    tracerCalls: [] as Array<[string, string | undefined]>,
    counters: new Map<string, { add: ReturnType<typeof vi.fn> }>(),
    histograms: new Map<string, { record: ReturnType<typeof vi.fn> }>(),
    activeSpan: undefined as { spanContext: () => Record<string, string> } | undefined,
    nodeSdkConfigs: [] as Record<string, unknown>[],
    metricReaderOptions: [] as unknown[],
    start: vi.fn(),
    shutdown: vi.fn(),
    resourceFromAttributes: vi.fn(),
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
  };

  function reset(): void {
    state.spans = [];
    state.startActiveSpanOptions = [];
    state.tracerCalls = [];
    state.counters.clear();
    state.histograms.clear();
    state.activeSpan = undefined;
    state.nodeSdkConfigs = [];
    state.metricReaderOptions = [];
    state.start.mockReset();
    state.shutdown.mockReset();
    state.shutdown.mockResolvedValue(undefined);
    state.resourceFromAttributes.mockReset();
    state.resourceFromAttributes.mockImplementation((attributes: unknown) => ({
      __resource: attributes,
    }));
    state.createCounter.mockReset();
    state.createCounter.mockImplementation((name: string) => {
      const existing = state.counters.get(name);
      if (existing) {
        return existing;
      }
      const counter = { add: vi.fn() };
      state.counters.set(name, counter);
      return counter;
    });
    state.createHistogram.mockReset();
    state.createHistogram.mockImplementation((name: string) => {
      const existing = state.histograms.get(name);
      if (existing) {
        return existing;
      }
      const histogram = { record: vi.fn() };
      state.histograms.set(name, histogram);
      return histogram;
    });
  }

  return { state, reset };
});

vi.mock('@opentelemetry/api', () => {
  const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 } as const;
  const trace = {
    getTracer: (name: string, version?: string) => {
      otel.state.tracerCalls.push([name, version]);
      return {
        startActiveSpan: <T>(
          _name: string,
          options: unknown,
          callback: (span: FakeSpan) => T,
        ): T => {
          otel.state.startActiveSpanOptions.push(options);
          const span: FakeSpan = {
            setAttribute: vi.fn(),
            recordException: vi.fn(),
            setStatus: vi.fn(),
            end: vi.fn(),
          };
          otel.state.spans.push(span);
          return callback(span);
        },
      };
    },
    getSpan: () => otel.state.activeSpan,
  };
  const metrics = {
    getMeter: () => ({
      createCounter: otel.state.createCounter,
      createHistogram: otel.state.createHistogram,
    }),
  };
  const context = { active: () => ({ __context: true }) };
  return { trace, metrics, context, SpanStatusCode };
});

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    public readonly start = otel.state.start;
    public readonly shutdown = otel.state.shutdown;
    public constructor(config: Record<string, unknown>) {
      otel.state.nodeSdkConfigs.push(config);
    }
  },
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: class {
    public constructor(options: unknown) {
      otel.state.metricReaderOptions.push(options);
    }
  },
}));

vi.mock('@opentelemetry/exporter-metrics-otlp-proto', () => ({
  OTLPMetricExporter: class {},
}));

vi.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({
  OTLPTraceExporter: class {},
}));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: otel.state.resourceFromAttributes,
}));

// `telemetry.ts` imports this adapter, so other specs may cache the real
// `@opentelemetry/*` modules first. Under the shared `--no-isolate` pool that
// would bypass the mocks above, so reset the registry and re-import the adapter
// against the mocked SDK (in `beforeAll` to avoid top-level await under node16).
let OtelTelemetry: typeof OtelModule.OtelTelemetry;
let createOtelTelemetry: typeof OtelModule.createOtelTelemetry;

beforeAll(async () => {
  vi.resetModules();
  // Indirect specifier sidesteps the node16 literal-extension rule for dynamic
  // imports while keeping the mock-bound re-import; the cast restores the types.
  const modulePath = '../../../../../src/framework/observability/otelTelemetry';
  const mod = (await import(modulePath)) as typeof OtelModule;
  OtelTelemetry = mod.OtelTelemetry;
  createOtelTelemetry = mod.createOtelTelemetry;
});

function buildConfig(overrides: Partial<TelemetryRuntimeConfig> = {}): TelemetryRuntimeConfig {
  return {
    enabled: true,
    strict: false,
    serviceName: 'auroraflow',
    serviceVersion: '1.0.0',
    environment: 'ci',
    exportRawSelectors: false,
    metricExportIntervalMs: 10_000,
    shutdownTimeoutMs: 3_000,
    resourceAttributes: { 'service.name': 'auroraflow' },
    ...overrides,
  };
}

function buildLogger(): {
  warn: ReturnType<typeof vi.fn<DiagnosticLogMethod>>;
  error: ReturnType<typeof vi.fn<DiagnosticLogMethod>>;
} {
  const logger = { warn: vi.fn<DiagnosticLogMethod>(), error: vi.fn<DiagnosticLogMethod>() };
  return logger satisfies TelemetryDiagnosticLogger;
}

describe('OtelTelemetry', () => {
  beforeEach(() => {
    otel.reset();
  });

  it('builds and starts the SDK with the configured resource and metric reader', () => {
    const config = buildConfig();
    new OtelTelemetry(config, buildLogger());

    expect(otel.state.resourceFromAttributes).toHaveBeenCalledWith(config.resourceAttributes);
    expect(otel.state.start).toHaveBeenCalledTimes(1);
    expect(otel.state.nodeSdkConfigs).toHaveLength(1);
    const sdkConfig = otel.state.nodeSdkConfigs[0];
    expect(sdkConfig.autoDetectResources).toBe(false);
    expect(Array.isArray(sdkConfig.metricReaders)).toBe(true);
    expect((sdkConfig.metricReaders as unknown[]).length).toBe(1);
    expect(otel.state.metricReaderOptions).toHaveLength(1);
  });

  it('reports as enabled', () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());
    expect(telemetry.isEnabled()).toBe(true);
  });

  it('runs a span, drops undefined attributes, sets ok status, and ends it', async () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());

    const result = await telemetry.runSpan({
      name: 'auroraflow.test',
      attributes: { kept: 'yes', dropped: undefined },
      task: async (span) => {
        span.setAttribute('inner', 1);
        return 'value';
      },
    });

    expect(result).toBe('value');
    expect(otel.state.tracerCalls).toContainEqual(['auroraflow', '1.0.0']);
    expect(otel.state.startActiveSpanOptions[0]).toEqual({ attributes: { kept: 'yes' } });
    const span = otel.state.spans[0];
    expect(span.setAttribute).toHaveBeenCalledWith('inner', 1);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 1, message: undefined });
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.recordException).not.toHaveBeenCalled();
  });

  it('records exceptions, marks error status, ends the span, and rethrows', async () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());
    const failure = new Error('span failed');

    await expect(
      telemetry.runSpan({
        name: 'auroraflow.test',
        task: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    const span = otel.state.spans[0];
    expect(span.recordException).toHaveBeenCalledWith(failure);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'span failed' });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('normalizes non-Error throwables for exception recording', async () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());

    await expect(
      telemetry.runSpan({
        name: 'auroraflow.test',
        task: async () => {
          throw 'string failure';
        },
      }),
    ).rejects.toBe('string failure');

    const span = otel.state.spans[0];
    expect(span.recordException).toHaveBeenCalledWith(new Error('string failure'));
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'string failure' });
  });

  it('records positive counters once per name and ignores invalid values', () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());
    const name = METRIC_NAMES.redisOperationsTotal;

    telemetry.recordCounter(name, 5, { status: 'ok', dropped: undefined });
    telemetry.recordCounter(name, 0);
    telemetry.recordCounter(name, -1);
    telemetry.recordCounter(name, Number.NaN);

    const counter = otel.state.counters.get(name);
    expect(counter?.add).toHaveBeenCalledTimes(1);
    expect(counter?.add).toHaveBeenCalledWith(5, { status: 'ok' });
    expect(otel.state.createCounter).toHaveBeenCalledTimes(1);
  });

  it('records non-negative histograms once per name and ignores invalid values', () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());
    const name = METRIC_NAMES.redisOperationDurationMs;

    telemetry.recordHistogram(name, 12);
    telemetry.recordHistogram(name, 0);
    telemetry.recordHistogram(name, -1);
    telemetry.recordHistogram(name, Number.POSITIVE_INFINITY);

    const histogram = otel.state.histograms.get(name);
    expect(histogram?.record).toHaveBeenCalledTimes(2);
    expect(histogram?.record).toHaveBeenNthCalledWith(1, 12, {});
    expect(histogram?.record).toHaveBeenNthCalledWith(2, 0, {});
    expect(otel.state.createHistogram).toHaveBeenCalledTimes(1);
  });

  it('returns trace/span ids only when an active recording span exists', () => {
    const telemetry = new OtelTelemetry(buildConfig(), buildLogger());

    expect(telemetry.getLogCorrelation()).toEqual({});

    otel.state.activeSpan = { spanContext: () => ({ traceId: '', spanId: 'span-1' }) };
    expect(telemetry.getLogCorrelation()).toEqual({});

    otel.state.activeSpan = { spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1' }) };
    expect(telemetry.getLogCorrelation()).toEqual({ traceId: 'trace-1', spanId: 'span-1' });
  });

  it('shuts down cleanly when the SDK resolves', async () => {
    const logger = buildLogger();
    const telemetry = new OtelTelemetry(buildConfig(), logger);

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
    expect(otel.state.shutdown).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when shutdown fails in non-strict mode', async () => {
    const logger = buildLogger();
    otel.state.shutdown.mockRejectedValueOnce(new Error('collector down'));
    const telemetry = new OtelTelemetry(buildConfig({ strict: false }), logger);

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('AuroraFlow observability shutdown failed.', {
      errorMessage: 'collector down',
    });
  });

  it('rethrows shutdown failures in strict mode', async () => {
    const logger = buildLogger();
    otel.state.shutdown.mockRejectedValueOnce(new Error('collector down'));
    const telemetry = new OtelTelemetry(buildConfig({ strict: true }), logger);

    await expect(telemetry.shutdown()).rejects.toThrow('collector down');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('enforces the shutdown timeout budget', async () => {
    const logger = buildLogger();
    // Never resolves: the real timeout must win and surface the budget message.
    otel.state.shutdown.mockReturnValueOnce(new Promise<void>(() => {}));
    const telemetry = new OtelTelemetry(buildConfig({ shutdownTimeoutMs: 10 }), logger);

    await telemetry.shutdown();

    expect(logger.warn).toHaveBeenCalledWith('AuroraFlow observability shutdown failed.', {
      errorMessage: 'OpenTelemetry shutdown exceeded 10ms.',
    });
  });
});

describe('createOtelTelemetry', () => {
  beforeEach(() => {
    otel.reset();
  });

  it('constructs an enabled OtelTelemetry instance', () => {
    const telemetry = createOtelTelemetry(buildConfig(), buildLogger());
    expect(telemetry).toBeInstanceOf(OtelTelemetry);
    expect(telemetry.isEnabled()).toBe(true);
    expect(otel.state.start).toHaveBeenCalledTimes(1);
  });
});
