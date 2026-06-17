import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
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
    expect(
      cacheStep.with.get('restore-keys'),
      'Browser cache must fall back to an install_args-scoped prefix so dependency bumps reuse browsers instead of cold-downloading.',
    ).toBe('${{ runner.os }}-playwright-${{ matrix.install_args }}-');
  });

  it('always installs the required browser even when cache is restored', () => {
    const installStep = getWorkflowStep(
      getWorkflowJob(ciWorkflow, 'e2e'),
      'Ensure required Playwright browser is installed',
    );

    const installRun = installStep.run ?? '';

    expectInvariant(
      installStep.if === undefined,
      'Browser install step must not be cache-gated; restored caches can still miss executables.',
    );
    expectTextIncludes(installRun, {
      text: 'timeout 300 npx playwright install --with-deps ${{ matrix.install_args }}',
      rationale:
        'Browser install must run the matrix-selected browser under a bounded per-attempt timeout so network hangs fail fast instead of consuming the job budget.',
    });
    expectTextIncludes(installRun, {
      text: 'for attempt in 1 2 3',
      rationale: 'Browser install must retry to absorb transient registry/apt failures.',
    });
  });
});
