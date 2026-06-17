import { describe, expect, it } from 'vitest';
import { expectInvariant } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const ciWorkflow = readWorkflowModel('.github/workflows/ci.yml');

describe('ci.yml browser provisioning contract', () => {
  it('defines install_args for each E2E matrix project', () => {
    const e2eJob = getWorkflowJob(ciWorkflow, 'e2e');
    const expectedProjectMappings = [
      { project: 'Google Chrome', installArgs: 'chrome' },
      { project: 'Firefox', installArgs: 'firefox' },
      { project: 'Safari', installArgs: 'webkit' },
      { project: 'Microsoft Edge', installArgs: 'msedge' },
      { project: 'Mobile Chrome', installArgs: 'chromium' },
      { project: 'Mobile Safari', installArgs: 'webkit' },
    ];

    expect(
      e2eJob.strategy?.include.map((entry) => ({
        project: entry.get('project'),
        installArgs: entry.get('install_args'),
      })),
      'E2E matrix must map every browser project to matching Playwright install arguments.',
    ).toEqual(expectedProjectMappings);
  });

  it('uses a browser cache key scoped by install_args', () => {
    const cacheStep = getWorkflowStep(
      getWorkflowJob(ciWorkflow, 'e2e'),
      'Cache Playwright browsers',
    );

    expect(
      cacheStep.with.get('key'),
      'Browser cache key must be partitioned by matrix.install_args to avoid cross-browser reuse.',
    ).toBe(
      "${{ runner.os }}-playwright-${{ matrix.install_args }}-${{ hashFiles('package-lock.json') }}",
    );
  });

  it('always installs the required browser even when cache is restored', () => {
    const installStep = getWorkflowStep(
      getWorkflowJob(ciWorkflow, 'e2e'),
      'Ensure required Playwright browser is installed',
    );

    expectInvariant(
      installStep.if === undefined,
      'Browser install step must not be cache-gated; restored caches can still miss executables.',
    );
    expect(
      installStep.run,
      'Browser install step must install the matrix-selected browser explicitly.',
    ).toBe('npx playwright install --with-deps ${{ matrix.install_args }}');
  });
});
