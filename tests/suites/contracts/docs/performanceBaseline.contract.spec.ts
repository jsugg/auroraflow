import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonRecord(relativePath: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
  if (!isRecord(value)) {
    throw new Error(`${relativePath} must contain a JSON object.`);
  }
  return value;
}

describe('failure-path performance baseline contract', () => {
  it('records all failure-path measurements without an approved hard threshold', () => {
    const baseline = readJsonRecord('docs/quality/failure-path-baseline.json');

    expect(baseline).toMatchObject({
      benchmark: 'auroraflow-failure-path',
      policy: {
        approvalStatus: 'pending',
        enforcement: 'warning_only',
        hardThresholds: null,
      },
      schemaVersion: 2,
    });
    const results = baseline.results;
    if (!isRecord(results)) {
      throw new Error('Performance baseline results must be a JSON object.');
    }
    for (const measurementName of [
      'aggregateFailurePathDurationMs',
      'domSnapshotDurationMs',
      'satCandidateExtractionDurationMs',
      'artifactWriteDurationMs',
    ]) {
      const measurement = results[measurementName];
      if (!isRecord(measurement) || typeof measurement.sampleCount !== 'number') {
        throw new Error(`${measurementName} must expose a numeric sampleCount.`);
      }
      expect(measurement.sampleCount).toBeGreaterThan(0);
    }
  });

  it('keeps the benchmark manual and outside the required verification chain', () => {
    const packageJson = readJsonRecord('package.json');
    const scripts = packageJson.scripts;
    if (!isRecord(scripts) || typeof scripts.verify !== 'string') {
      throw new Error('package.json scripts.verify must be a string.');
    }
    const verifySteps = scripts.verify.split('&&').map((step) => step.trim());

    expect(scripts).toEqual(
      expect.objectContaining({
        'benchmark:failure-path': 'node -r ts-node/register scripts/failure-path-benchmark.ts',
        'benchmark:failure-path:record': 'npm run benchmark:failure-path -- --record',
      }),
    );
    expect(verifySteps).not.toEqual(expect.arrayContaining(['npm run benchmark:failure-path']));
  });
});
