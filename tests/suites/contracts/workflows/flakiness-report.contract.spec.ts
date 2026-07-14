import { describe, expect, it } from 'vitest';
import { expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const ciWorkflow = readWorkflowModel('.github/workflows/ci.yml');

describe('ci.yml flakiness report contract', () => {
  it('emits binary-scoped Playwright JSON output files from matrix runs', () => {
    expect(
      getWorkflowStep(getWorkflowJob(ciWorkflow, 'e2e'), 'Run full E2E suite').env.get(
        'PLAYWRIGHT_JSON_OUTPUT_FILE',
      ),
      'E2E matrix must emit binary-scoped JSON files for flakiness aggregation.',
    ).toBe('test-results/playwright-results-${{ matrix.slug }}.json');
  });

  it('defines a dedicated flakiness report job that aggregates matrix artifacts', () => {
    const flakinessJob = getWorkflowJob(ciWorkflow, 'flakiness-report');

    expect(flakinessJob.name).toBe('Flakiness Report');
    expect(getWorkflowStep(flakinessJob, 'Download E2E matrix artifacts').with.get('pattern')).toBe(
      'e2e-matrix-artifacts-*',
    );
    expect(getWorkflowStep(flakinessJob, 'Restore flakiness trend history').with.get('path')).toBe(
      '.auroraflow-trends/flakiness-trends.jsonl',
    );
    const generateRun = getWorkflowStep(flakinessJob, 'Generate flakiness summary').run ?? '';
    for (const text of [
      'npm run flakiness:report --',
      '--input-dir aggregated-e2e-artifacts/test-results',
      '--output-json aggregated-e2e-artifacts/flakiness-summary.json',
      '--trend-output .auroraflow-trends/flakiness-trends.jsonl',
      'cp .auroraflow-trends/flakiness-trends.jsonl aggregated-e2e-artifacts/flakiness-trends.jsonl',
    ]) {
      expectTextIncludes(generateRun, {
        text,
        rationale:
          'Flakiness job must generate summary and persistent trend artifacts from matrix output.',
      });
    }
    expect(getWorkflowStep(flakinessJob, 'Upload flakiness report artifact').with.get('name')).toBe(
      'flakiness-report',
    );
  });
});
