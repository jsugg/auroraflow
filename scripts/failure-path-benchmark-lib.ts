import path from 'node:path';

const DEFAULT_ITERATIONS = 12;
const DEFAULT_WARMUP_ITERATIONS = 3;
const DEFAULT_OUTPUT_PATH = path.join('test-results', 'performance', 'failure-path-benchmark.json');

export const FAILURE_PATH_BASELINE_PATH = path.join(
  'docs',
  'quality',
  'failure-path-baseline.json',
);

export const FAILURE_PATH_MEASUREMENT_NAMES = [
  'aggregateFailurePathDurationMs',
  'domSnapshotDurationMs',
  'satCandidateExtractionDurationMs',
  'artifactWriteDurationMs',
] as const;

export const MAX_BENCHMARK_ITERATIONS = 100;

export interface FailurePathBenchmarkOptions {
  readonly iterations: number;
  readonly outputPath: string;
  readonly recordBaseline: boolean;
  readonly warmupIterations: number;
}

export interface DurationSummary {
  readonly maximum: number;
  readonly mean: number;
  readonly median: number;
  readonly minimum: number;
  readonly p95: number;
  readonly sampleCount: number;
}

export type FailurePathMeasurementName = (typeof FAILURE_PATH_MEASUREMENT_NAMES)[number];

export type FailurePathBenchmarkResults = Readonly<
  Record<FailurePathMeasurementName, DurationSummary>
>;

export interface WarningOnlyRegressionObservation {
  readonly baselineMedianMs: number;
  readonly currentMedianMs: number;
  readonly deltaMs: number;
  readonly deltaPercent: number | null;
  readonly measurement: FailurePathMeasurementName;
  readonly trend: 'faster' | 'slower' | 'unchanged';
}

function parseIterationCount(rawValue: string, flagName: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BENCHMARK_ITERATIONS) {
    throw new Error(`${flagName} must be an integer between 1 and ${MAX_BENCHMARK_ITERATIONS}.`);
  }
  return parsed;
}

export function parseFailurePathBenchmarkOptions(
  argv: readonly string[],
): FailurePathBenchmarkOptions {
  let iterations = DEFAULT_ITERATIONS;
  let outputPath: string | undefined;
  let recordBaseline = false;
  let warmupIterations = DEFAULT_WARMUP_ITERATIONS;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--record') {
      recordBaseline = true;
      continue;
    }
    const value = argv[index + 1];
    if (argument === '--iterations' || argument === '--warmups' || argument === '--output') {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--iterations') {
        iterations = parseIterationCount(value, argument);
      } else if (argument === '--warmups') {
        warmupIterations = parseIterationCount(value, argument);
      } else {
        outputPath = value;
      }
      continue;
    }
    throw new Error(`Unknown failure-path benchmark option: ${argument ?? '<empty>'}.`);
  }

  return {
    iterations,
    outputPath: path.resolve(
      outputPath ?? (recordBaseline ? FAILURE_PATH_BASELINE_PATH : DEFAULT_OUTPUT_PATH),
    ),
    recordBaseline,
    warmupIterations,
  };
}

function roundMilliseconds(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  const index = Math.max(0, Math.ceil(percentileValue * sortedValues.length) - 1);
  const value = sortedValues[index];
  if (value === undefined) {
    throw new Error('Cannot calculate a percentile without duration samples.');
  }
  return value;
}

export function summarizeDurations(values: readonly number[]): DurationSummary {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Duration samples must contain one or more finite, non-negative values.');
  }
  const sortedValues = [...values].sort((left, right) => left - right);
  const sum = sortedValues.reduce((total, value) => total + value, 0);
  return {
    maximum: roundMilliseconds(sortedValues[sortedValues.length - 1] ?? 0),
    mean: roundMilliseconds(sum / sortedValues.length),
    median: roundMilliseconds(percentile(sortedValues, 0.5)),
    minimum: roundMilliseconds(sortedValues[0] ?? 0),
    p95: roundMilliseconds(percentile(sortedValues, 0.95)),
    sampleCount: sortedValues.length,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite, non-negative number.`);
  }
  return value;
}

function parseDurationSummary(value: unknown, measurement: string): DurationSummary {
  if (!isRecord(value)) {
    throw new Error(`${measurement} must be an object.`);
  }
  const maximum = parseNonNegativeNumber(value.maximum, `${measurement}.maximum`);
  const mean = parseNonNegativeNumber(value.mean, `${measurement}.mean`);
  const median = parseNonNegativeNumber(value.median, `${measurement}.median`);
  const minimum = parseNonNegativeNumber(value.minimum, `${measurement}.minimum`);
  const p95 = parseNonNegativeNumber(value.p95, `${measurement}.p95`);
  const sampleCount = parseNonNegativeNumber(value.sampleCount, `${measurement}.sampleCount`);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error(`${measurement}.sampleCount must be a positive integer.`);
  }
  if (minimum > median || median > p95 || p95 > maximum || mean < minimum || mean > maximum) {
    throw new Error(`${measurement} contains inconsistent duration statistics.`);
  }
  return {
    maximum,
    mean,
    median,
    minimum,
    p95,
    sampleCount,
  };
}

export function parseFailurePathBenchmarkResults(value: unknown): FailurePathBenchmarkResults {
  if (!isRecord(value)) {
    throw new Error('Failure-path benchmark results must be an object.');
  }
  return {
    aggregateFailurePathDurationMs: parseDurationSummary(
      value.aggregateFailurePathDurationMs,
      'aggregateFailurePathDurationMs',
    ),
    domSnapshotDurationMs: parseDurationSummary(
      value.domSnapshotDurationMs,
      'domSnapshotDurationMs',
    ),
    satCandidateExtractionDurationMs: parseDurationSummary(
      value.satCandidateExtractionDurationMs,
      'satCandidateExtractionDurationMs',
    ),
    artifactWriteDurationMs: parseDurationSummary(
      value.artifactWriteDurationMs,
      'artifactWriteDurationMs',
    ),
  };
}

export function compareFailurePathBenchmarkResults(
  current: FailurePathBenchmarkResults,
  baseline: FailurePathBenchmarkResults,
): readonly WarningOnlyRegressionObservation[] {
  return FAILURE_PATH_MEASUREMENT_NAMES.map((measurement) => {
    const baselineMedianMs = baseline[measurement].median;
    const currentMedianMs = current[measurement].median;
    const deltaMs = roundMilliseconds(currentMedianMs - baselineMedianMs);
    const deltaPercent =
      baselineMedianMs === 0 ? null : roundMilliseconds((deltaMs / baselineMedianMs) * 100);
    return {
      baselineMedianMs,
      currentMedianMs,
      deltaMs,
      deltaPercent,
      measurement,
      trend: deltaMs > 0 ? 'slower' : deltaMs < 0 ? 'faster' : 'unchanged',
    };
  });
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(3)}`;
}

export function formatWarningOnlyRegressionReport(
  current: FailurePathBenchmarkResults,
  baseline: FailurePathBenchmarkResults,
): string {
  const observations = compareFailurePathBenchmarkResults(current, baseline);
  const lines = observations.map((observation) => {
    const deltaPercent =
      observation.deltaPercent === null ? 'n/a' : `${formatSigned(observation.deltaPercent)}%`;
    return [
      `WARNING-ONLY: ${observation.measurement}`,
      `median ${observation.currentMedianMs.toFixed(3)} ms`,
      `baseline ${observation.baselineMedianMs.toFixed(3)} ms`,
      `delta ${formatSigned(observation.deltaMs)} ms (${deltaPercent})`,
      `trend ${observation.trend}`,
    ].join('; ');
  });
  return `Warning-only regression report (median vs committed baseline):\n${lines.join('\n')}\n`;
}
