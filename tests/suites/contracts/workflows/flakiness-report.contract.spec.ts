import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/ci.yml');
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

describe('ci.yml flakiness report contract', () => {
  it('emits shard-scoped Playwright JSON output files from matrix runs', () => {
    expect(ciWorkflow).toContain('PLAYWRIGHT_JSON_OUTPUT_FILE:');
    expect(ciWorkflow).toContain(
      'playwright-results-${{ matrix.project_slug }}-shard-${{ matrix.shard }}.json',
    );
  });

  it('defines a dedicated flakiness report job that aggregates matrix artifacts', () => {
    expect(ciWorkflow).toContain('flakiness-report:');
    expect(ciWorkflow).toContain('name: Flakiness Report');
    expect(ciWorkflow).toContain('pattern: e2e-matrix-artifacts-*');
    expect(ciWorkflow).toContain('run: npm run flakiness:report --');
    expect(ciWorkflow).toContain('name: flakiness-report');
  });
});
