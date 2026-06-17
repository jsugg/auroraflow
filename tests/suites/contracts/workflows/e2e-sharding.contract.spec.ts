import { describe, expect, it } from 'vitest';
import {
  getWorkflowJob,
  getWorkflowMatrixValues,
  getWorkflowStep,
  readWorkflowModel,
} from '../../../helpers/workflowModel';

const ciWorkflow = readWorkflowModel('.github/workflows/ci.yml');

describe('ci.yml e2e sharding contract', () => {
  it('defines a two-shard matrix for the full E2E job', () => {
    expect(
      getWorkflowMatrixValues(getWorkflowJob(ciWorkflow, 'e2e'), 'shard'),
      'Full E2E matrix must split coverage across exactly two shards.',
    ).toEqual(['1', '2']);
  });

  it('runs each matrix cell with explicit Playwright shard arguments', () => {
    expect(
      getWorkflowStep(getWorkflowJob(ciWorkflow, 'e2e'), 'Run full E2E suite').run,
      'Full E2E runner must pass matrix shard into Playwright.',
    ).toBe(
      'npx playwright test --config=configs/playwright.config.ts --project="${{ matrix.project }}" --shard=${{ matrix.shard }}/2',
    );
  });

  it('uses shard-specific artifact names to avoid collisions', () => {
    expect(
      getWorkflowStep(getWorkflowJob(ciWorkflow, 'e2e'), 'Upload E2E artifacts').with.get('name'),
      'Uploaded E2E artifacts must include project and shard to avoid matrix collisions.',
    ).toBe('e2e-matrix-artifacts-${{ matrix.project }}-shard-${{ matrix.shard }}');
  });
});
