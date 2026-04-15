import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/ci.yml');
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

describe('ci.yml e2e sharding contract', () => {
  it('defines a two-shard matrix for the full E2E job', () => {
    expect(ciWorkflow).toMatch(/shard:\s*\[1,\s*2\]/);
  });

  it('runs each matrix cell with explicit Playwright shard arguments', () => {
    expect(ciWorkflow).toContain('--shard=${{ matrix.shard }}/2');
  });

  it('uses shard-specific artifact names to avoid collisions', () => {
    expect(ciWorkflow).toContain(
      'name: e2e-matrix-artifacts-${{ matrix.project }}-shard-${{ matrix.shard }}',
    );
  });
});
