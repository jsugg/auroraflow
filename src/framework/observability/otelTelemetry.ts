import {
  context,
  metrics,
  trace,
  SpanStatusCode,
  type Attributes,
  type Counter,
  type Histogram,
  type Span,
} from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { MetricName } from './metricNames';
import type {
  AuroraFlowTelemetry,
  TelemetryAttributeValue,
  TelemetryAttributes,
  TelemetryDiagnosticLogger,
  TelemetryLogCorrelation,
  TelemetryOperationOptions,
  TelemetrySpan,
  TelemetrySpanStatus,
} from './telemetry';
import type { TelemetryRuntimeConfig } from './telemetryConfig';

function normalizeAttributes(attributes: TelemetryAttributes | undefined): Attributes {
  const normalized: Attributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class OtelTelemetrySpan implements TelemetrySpan {
  public constructor(private readonly span: Span) {}

  public setAttribute(key: string, value: TelemetryAttributeValue): void {
    this.span.setAttribute(key, value);
  }

  public recordException(error: Error): void {
    this.span.recordException(error);
  }

  public setStatus(status: TelemetrySpanStatus): void {
    this.span.setStatus({
      code: status.code === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: status.message,
    });
  }
}

function withTimeout<TValue>({
  task,
  timeoutMs,
  timeoutMessage,
}: {
  task: Promise<TValue>;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<TValue> {
  return new Promise<TValue>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    task.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

export class OtelTelemetry implements AuroraFlowTelemetry {
  private readonly sdk: NodeSDK;
  private readonly counters = new Map<MetricName, Counter>();
  private readonly histograms = new Map<MetricName, Histogram>();

  public constructor(
    public readonly config: TelemetryRuntimeConfig,
    private readonly logger: TelemetryDiagnosticLogger,
  ) {
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: config.metricExportIntervalMs,
    });

    this.sdk = new NodeSDK({
      autoDetectResources: false,
      resource: resourceFromAttributes(config.resourceAttributes),
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [metricReader],
      logRecordProcessors: [],
    });
    this.sdk.start();
  }

  public isEnabled(): boolean {
    return true;
  }

  public async runSpan<TValue>({
    name,
    attributes,
    task,
  }: TelemetryOperationOptions<TValue>): Promise<TValue> {
    const tracer = trace.getTracer(this.config.serviceName, this.config.serviceVersion);
    return tracer.startActiveSpan(
      name,
      { attributes: normalizeAttributes(attributes) },
      async (span) => {
        const telemetrySpan = new OtelTelemetrySpan(span);
        try {
          const result = await task(telemetrySpan);
          telemetrySpan.setStatus({ code: 'ok' });
          return result;
        } catch (error: unknown) {
          const normalizedError = normalizeError(error);
          telemetrySpan.recordException(normalizedError);
          telemetrySpan.setStatus({ code: 'error', message: normalizedError.message });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  public recordCounter(name: MetricName, value: number, attributes?: TelemetryAttributes): void {
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const counter = this.resolveCounter(name);
    counter.add(value, normalizeAttributes(attributes));
  }

  public recordHistogram(name: MetricName, value: number, attributes?: TelemetryAttributes): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    const histogram = this.resolveHistogram(name);
    histogram.record(value, normalizeAttributes(attributes));
  }

  public getLogCorrelation(): TelemetryLogCorrelation {
    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();
    if (!spanContext?.traceId || !spanContext.spanId) {
      return {};
    }
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }

  public async shutdown(): Promise<void> {
    try {
      await withTimeout({
        task: this.sdk.shutdown(),
        timeoutMs: this.config.shutdownTimeoutMs,
        timeoutMessage: `OpenTelemetry shutdown exceeded ${this.config.shutdownTimeoutMs}ms.`,
      });
    } catch (error: unknown) {
      const normalizedError = normalizeError(error);
      if (this.config.strict) {
        throw normalizedError;
      }
      this.logger.warn('AuroraFlow observability shutdown failed.', {
        errorMessage: normalizedError.message,
      });
    }
  }

  private resolveCounter(name: MetricName): Counter {
    const existing = this.counters.get(name);
    if (existing) {
      return existing;
    }
    const counter = metrics.getMeter(this.config.serviceName).createCounter(name);
    this.counters.set(name, counter);
    return counter;
  }

  private resolveHistogram(name: MetricName): Histogram {
    const existing = this.histograms.get(name);
    if (existing) {
      return existing;
    }
    const histogram = metrics.getMeter(this.config.serviceName).createHistogram(name, {
      unit: 'ms',
    });
    this.histograms.set(name, histogram);
    return histogram;
  }
}

export function createOtelTelemetry(
  config: TelemetryRuntimeConfig,
  logger: TelemetryDiagnosticLogger,
): AuroraFlowTelemetry {
  return new OtelTelemetry(config, logger);
}
