import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'playwright-peer-matrix.yml',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

describe('Playwright peer matrix workflow', () => {
  it('tests floor, lockfile-current, and latest supported 1.x lanes', () => {
    expect(workflow).toContain('- lane: floor\n            version_spec: 1.59.1');
    expect(workflow).toContain("- lane: current\n            version_spec: ''");
    expect(workflow).toContain('- lane: latest\n            version_spec: ^1.59.0');
    expect(workflow).toContain('Playwright ${process.env.PLAYWRIGHT_LANE}: ${playwrightVersion}');
    expect(workflow).toContain('playwright-core@${PLAYWRIGHT_VERSION_SPEC}');
    expect(workflow).toContain('outside >=1.59 <2');
  });

  it('runs heavy browser coverage only on scheduled, manual, or release calls', () => {
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '0 5 * * 0'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('workflow_call:');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).toContain('npx playwright install --with-deps chrome');
    expect(workflow).toContain('npm run test:smoke');
  });

  it('keeps compatibility scope focused and bounded', () => {
    expect(workflow).toContain('timeout-minutes: 20');
    expect(workflow).toContain('max-parallel: 2');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('pageObjectBase.spec.ts');
    expect(workflow).not.toContain('test:e2e');
  });
});
