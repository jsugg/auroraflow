import type { MetricName } from '../../../../../src/framework/observability/metricNames';
import {
  type AuroraFlowTelemetry,
  type TelemetryAttributes,
  type TelemetryAttributeValue,
  type TelemetryLogCorrelation,
  type TelemetryOperationOptions,
  type TelemetrySpan,
  type TelemetrySpanStatus,
} from '../../../../../src/framework/observability/telemetry';
import { resolveTelemetryConfig } from '../../../../../src/framework/observability/telemetryConfig';

export type CapturedAttributes = Record<string, TelemetryAttributeValue>;

export interface CapturedMetric {
  name: MetricName;
  value: number;
  attributes: CapturedAttributes;
}

export interface CapturedSpan {
  name: string;
  attributes: CapturedAttributes;
  exceptions: Error[];
  status?: TelemetrySpanStatus;
}

class CapturingSpan implements TelemetrySpan {
  public readonly attributes: CapturedAttributes;
  public readonly exceptions: Error[] = [];
  public status: TelemetrySpanStatus | undefined;

  public constructor(attributes: TelemetryAttributes | undefined) {
    this.attributes = normalizeAttributes(attributes);
  }

  public setAttribute(key: string, value: TelemetryAttributeValue): void {
    this.attributes[key] = value;
  }

  public recordException(error: Error): void {
    this.exceptions.push(error);
  }

  public setStatus(status: TelemetrySpanStatus): void {
    this.status = status;
  }
}

export function normalizeAttributes(
  attributes: TelemetryAttributes | undefined,
): CapturedAttributes {
  const normalized: CapturedAttributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

export class CapturingTelemetry implements AuroraFlowTelemetry {
  public readonly config = resolveTelemetryConfig({
    AURORAFLOW_OBSERVABILITY_ENABLED: 'true',
  });
  public readonly spans: CapturedSpan[] = [];
  public readonly counters: CapturedMetric[] = [];
  public readonly histograms: CapturedMetric[] = [];

  public isEnabled(): boolean {
    return true;
  }

  public async runSpan<TValue>({
    name,
    attributes,
    task,
  }: TelemetryOperationOptions<TValue>): Promise<TValue> {
    const span = new CapturingSpan(attributes);
    const capturedSpan: CapturedSpan = {
      name,
      attributes: span.attributes,
      exceptions: span.exceptions,
    };
    this.spans.push(capturedSpan);

    try {
      const result = await task(span);
      span.setStatus({ code: 'ok' });
      return result;
    } catch (error: unknown) {
      span.setStatus({
        code: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      capturedSpan.status = span.status;
    }
  }

  public recordCounter(name: MetricName, value: number, attributes?: TelemetryAttributes): void {
    this.counters.push({ name, value, attributes: normalizeAttributes(attributes) });
  }

  public recordHistogram(name: MetricName, value: number, attributes?: TelemetryAttributes): void {
    this.histograms.push({ name, value, attributes: normalizeAttributes(attributes) });
  }

  public getLogCorrelation(): TelemetryLogCorrelation {
    return {};
  }

  public async shutdown(): Promise<void> {}
}
