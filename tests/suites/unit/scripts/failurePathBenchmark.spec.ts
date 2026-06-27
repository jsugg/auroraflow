import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FAILURE_PATH_FIXTURE_COMPONENTS,
  buildFailurePathFixtureHtml,
} from '../../../../benchmarks/fixtures/failurePathFixture';
import {
  compareFailurePathBenchmarkResults,
  formatWarningOnlyRegressionReport,
  parseFailurePathBenchmarkResults,
  parseFailurePathBenchmarkOptions,
  summarizeDurations,
  type FailurePathBenchmarkResults,
} from '../../../../scripts/failure-path-benchmark-lib';

function benchmarkResults(median: number): FailurePathBenchmarkResults {
  const summary = summarizeDurations([median]);
  return {
    aggregateFailurePathDurationMs: summary,
    domSnapshotDurationMs: summary,
    satCandidateExtractionDurationMs: summary,
    artifactWriteDurationMs: summary,
  };
}

describe('failure-path benchmark', () => {
  it('builds the same bounded fixture on every invocation', () => {
    const first = buildFailurePathFixtureHtml();
    const second = buildFailurePathFixtureHtml();

    expect(first).toBe(second);
    expect(first.match(/data-benchmark-row=/gu)).toHaveLength(FAILURE_PATH_FIXTURE_COMPONENTS);
    expect(first).toContain('data-testid="benchmark-disabled" disabled');
  });

  it('summarizes duration samples with deterministic nearest-rank percentiles', () => {
    expect(summarizeDurations([5, 1, 4, 2, 3])).toEqual({
      maximum: 5,
      mean: 3,
      median: 3,
      minimum: 1,
      p95: 5,
      sampleCount: 5,
    });
  });

  it('keeps record and smoke outputs separate without exposing a gate mode', () => {
    const smoke = parseFailurePathBenchmarkOptions([]);
    const record = parseFailurePathBenchmarkOptions(['--record']);

    expect(smoke.recordBaseline).toBe(false);
    expect(smoke.outputPath).toBe(
      path.resolve('test-results', 'performance', 'failure-path-benchmark.json'),
    );
    expect(record.recordBaseline).toBe(true);
    expect(record.outputPath).toBe(path.resolve('docs', 'quality', 'failure-path-baseline.json'));
    expect(() => parseFailurePathBenchmarkOptions(['--check'])).toThrow(
      'Unknown failure-path benchmark option: --check.',
    );
  });

  it('rejects missing, malformed, and excessive iteration bounds', () => {
    expect(() => parseFailurePathBenchmarkOptions(['--iterations'])).toThrow(
      'Missing value for --iterations.',
    );
    expect(() => parseFailurePathBenchmarkOptions(['--iterations', '0'])).toThrow(
      '--iterations must be an integer between 1 and 100.',
    );
    expect(() => parseFailurePathBenchmarkOptions(['--warmups', '101'])).toThrow(
      '--warmups must be an integer between 1 and 100.',
    );
  });

  it('compares every median without creating a performance gate', () => {
    const observations = compareFailurePathBenchmarkResults(
      {
        ...benchmarkResults(10),
        domSnapshotDurationMs: summarizeDurations([8]),
        artifactWriteDurationMs: summarizeDurations([12]),
      },
      benchmarkResults(10),
    );

    expect(observations).toEqual([
      expect.objectContaining({
        measurement: 'aggregateFailurePathDurationMs',
        trend: 'unchanged',
      }),
      expect.objectContaining({
        deltaPercent: -20,
        measurement: 'domSnapshotDurationMs',
        trend: 'faster',
      }),
      expect.objectContaining({
        measurement: 'satCandidateExtractionDurationMs',
        trend: 'unchanged',
      }),
      expect.objectContaining({
        deltaPercent: 20,
        measurement: 'artifactWriteDurationMs',
        trend: 'slower',
      }),
    ]);
  });

  it('validates all committed baseline measurements before comparison', () => {
    const results = benchmarkResults(1);

    expect(parseFailurePathBenchmarkResults(results)).toEqual(results);
    expect(() =>
      parseFailurePathBenchmarkResults({
        ...results,
        artifactWriteDurationMs: { ...results.artifactWriteDurationMs, median: Number.NaN },
      }),
    ).toThrow('artifactWriteDurationMs.median must be a finite, non-negative number.');
  });

  it('formats every timing delta as warning-only output', () => {
    const output = formatWarningOnlyRegressionReport(benchmarkResults(12), benchmarkResults(10));

    expect(output).toBe(
      [
        'Warning-only regression report (median vs committed baseline):',
        'WARNING-ONLY: aggregateFailurePathDurationMs; median 12.000 ms; baseline 10.000 ms; delta +2.000 ms (+20.000%); trend slower',
        'WARNING-ONLY: domSnapshotDurationMs; median 12.000 ms; baseline 10.000 ms; delta +2.000 ms (+20.000%); trend slower',
        'WARNING-ONLY: satCandidateExtractionDurationMs; median 12.000 ms; baseline 10.000 ms; delta +2.000 ms (+20.000%); trend slower',
        'WARNING-ONLY: artifactWriteDurationMs; median 12.000 ms; baseline 10.000 ms; delta +2.000 ms (+20.000%); trend slower',
        '',
      ].join('\n'),
    );
  });
});
