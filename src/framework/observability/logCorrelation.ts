import { getTelemetry, type TelemetryLogCorrelation } from './telemetry';

let correlationWarningEmitted = false;

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getTelemetryLogCorrelation(): TelemetryLogCorrelation {
  try {
    return getTelemetry().getLogCorrelation();
  } catch (error: unknown) {
    if (!correlationWarningEmitted) {
      correlationWarningEmitted = true;
      console.warn('AuroraFlow telemetry log correlation is unavailable.', {
        errorMessage: normalizeErrorMessage(error),
      });
    }
    return {};
  }
}
