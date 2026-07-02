import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const ciWorkflow = readWorkflowModel('.github/workflows/ci.yml');
const lockedInstallActionPath = './.github/actions/setup-node-cache';

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
    const setupStep = getWorkflowStep(
      getWorkflowJob(ciWorkflow, 'e2e'),
      'Setup locked Node.js dependencies and Playwright browser',
    );

    expect(setupStep.uses).toBe(lockedInstallActionPath);
    expect(setupStep.with.get('install-browsers')).toBe('true');
    expect(setupStep.with.get('browser-name')).toBe('${{ matrix.install_args }}');
    expect(setupStep.with.get('cache-namespace')).toBe('e2e-${{ matrix.install_args }}');
  });

  it('always installs the required browser even when cache is restored', () => {
    const setupStep = getWorkflowStep(
      getWorkflowJob(ciWorkflow, 'e2e'),
      'Setup locked Node.js dependencies and Playwright browser',
    );

    expectInvariant(
      setupStep.if === undefined,
      'Browser install step must not be cache-gated; restored caches can still miss executables.',
    );
    expectTextIncludes(setupStep.with.get('browser-name') ?? '', {
      text: '${{ matrix.install_args }}',
      rationale:
        'Browser install must run the matrix-selected browser; composite action enforces bounded retries.',
    });
  });
});
