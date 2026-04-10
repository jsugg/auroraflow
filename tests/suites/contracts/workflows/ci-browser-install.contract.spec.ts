import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/ci.yml');
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

describe('ci.yml browser provisioning contract', () => {
  it('defines install_args for each E2E matrix project', () => {
    const expectedProjectMappings = [
      { project: 'Google Chrome', installArgs: 'chrome' },
      { project: 'Firefox', installArgs: 'firefox' },
      { project: 'Safari', installArgs: 'webkit' },
      { project: 'Microsoft Edge', installArgs: 'msedge' },
      { project: 'Mobile Chrome', installArgs: 'chromium' },
      { project: 'Mobile Safari', installArgs: 'webkit' },
    ];

    for (const mapping of expectedProjectMappings) {
      const mappingRegex = new RegExp(
        `- project: ${mapping.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s+install_args: ${mapping.installArgs}`,
        'm',
      );
      expect(ciWorkflow).toMatch(mappingRegex);
    }
  });

  it('uses a browser cache key scoped by install_args', () => {
    expect(ciWorkflow).toContain(
      "key: ${{ runner.os }}-playwright-${{ matrix.install_args }}-${{ hashFiles('package-lock.json') }}",
    );
  });

  it('always installs the required browser even when cache is restored', () => {
    const installStep = ciWorkflow.match(
      /- name: Ensure required Playwright browser is installed[\s\S]*?(?=\n\s+- name:|\n$)/,
    );

    expect(installStep).not.toBeNull();
    expect(installStep?.[0]).not.toMatch(/\n\s+if:/);
    expect(installStep?.[0]).toContain(
      'run: npx playwright install --with-deps ${{ matrix.install_args }}',
    );
  });
});
