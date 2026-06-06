import type { MetricName } from './metricNames';
import { createNoopTelemetry } from './noopTelemetry';
import { createOtelTelemetry } from './otelTelemetry';
import { resolveTelemetryConfig, type TelemetryRuntimeConfig } from './telemetryConfig';

export type TelemetryAttributeValue = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryAttributeValue | undefined>>;

export interface TelemetrySpanStatus {
  code: 'ok' | 'error';
  message?: string;
}

export interface TelemetrySpan {
  setAttribute(key: string, value: TelemetryAttributeValue): void;
  recordException(error: Error): void;
  setStatus(status: TelemetrySpanStatus): void;
}

export interface TelemetryLogCorrelation {
  traceId?: string;
  spanId?: string;
}

export interface TelemetryDiagnosticLogger {
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

export interface TelemetryOperationOptions<TValue> {
  name: string;
  attributes?: TelemetryAttributes;
  task: (span: TelemetrySpan) => Promise<TValue>;
}

export interface AuroraFlowTelemetry {
  readonly config: TelemetryRuntimeConfig;
  isEnabled(): boolean;
  runSpan<TValue>(options: TelemetryOperationOptions<TValue>): Promise<TValue>;
  recordCounter(name: MetricName, value: number, attributes?: TelemetryAttributes): void;
  recordHistogram(name: MetricName, value: number, attributes?: TelemetryAttributes): void;
  getLogCorrelation(): TelemetryLogCorrelation;
  shutdown(): Promise<void>;
}

let currentTelemetry: AuroraFlowTelemetry | null = null;

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const consoleDiagnosticLogger: TelemetryDiagnosticLogger = {
  warn(message, metadata) {
    console.warn(message, metadata ?? {});
  },
  error(message, metadata) {
    console.error(message, metadata ?? {});
  },
};

export function initializeTelemetry({
  env = process.env,
  logger = consoleDiagnosticLogger,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  logger?: TelemetryDiagnosticLogger;
} = {}): AuroraFlowTelemetry {
  const config = resolveTelemetryConfig(env);
  if (!config.enabled) {
    currentTelemetry = createNoopTelemetry(config);
    return currentTelemetry;
  }

  try {
    currentTelemetry = createOtelTelemetry(config, logger);
    return currentTelemetry;
  } catch (error: unknown) {
    if (config.strict) {
      throw error;
    }
    logger.warn('AuroraFlow observability initialization failed; using no-op telemetry.', {
      errorMessage: normalizeErrorMessage(error),
    });
    currentTelemetry = createNoopTelemetry(config);
    return currentTelemetry;
  }
}

export function getTelemetry(): AuroraFlowTelemetry {
  currentTelemetry ??= initializeTelemetry();
  return currentTelemetry;
}

export async function shutdownTelemetry(): Promise<void> {
  const telemetry = getTelemetry();
  try {
    await telemetry.shutdown();
  } finally {
    currentTelemetry = null;
  }
}

export function setTelemetryForTests(telemetry: AuroraFlowTelemetry): void {
  currentTelemetry = telemetry;
}

export function resetTelemetryForTests(): void {
  currentTelemetry = null;
}
