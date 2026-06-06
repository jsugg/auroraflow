import type {
  AuroraFlowTelemetry,
  TelemetryAttributeValue,
  TelemetryLogCorrelation,
  TelemetryOperationOptions,
  TelemetrySpan,
  TelemetrySpanStatus,
} from './telemetry';
import { resolveTelemetryConfig, type TelemetryRuntimeConfig } from './telemetryConfig';

class NoopTelemetrySpan implements TelemetrySpan {
  public setAttribute(key: string, value: TelemetryAttributeValue): void {
    void key;
    void value;
  }

  public recordException(error: Error): void {
    void error;
  }

  public setStatus(status: TelemetrySpanStatus): void {
    void status;
  }
}

const NOOP_SPAN = new NoopTelemetrySpan();

export class NoopTelemetry implements AuroraFlowTelemetry {
  public constructor(public readonly config: TelemetryRuntimeConfig) {}

  public isEnabled(): boolean {
    return false;
  }

  public async runSpan<TValue>({ task }: TelemetryOperationOptions<TValue>): Promise<TValue> {
    return task(NOOP_SPAN);
  }

  public recordCounter(): void {}

  public recordHistogram(): void {}

  public getLogCorrelation(): TelemetryLogCorrelation {
    return {};
  }

  public async shutdown(): Promise<void> {}
}

export function createNoopTelemetry(
  config: TelemetryRuntimeConfig = resolveTelemetryConfig({}),
): AuroraFlowTelemetry {
  return new NoopTelemetry(config);
}
