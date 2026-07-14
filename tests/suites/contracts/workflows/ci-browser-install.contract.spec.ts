import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const ciWorkflow = readWorkflowModel('.github/workflows/ci.yml');
const lockedInstallActionPath = './.github/actions/setup-node-cache';

describe('ci.yml browser provisioning contract', () => {
  it('provisions exactly one browser binary per matrix lane through the composite action', () => {
    const setupStep = getWorkflowStep(
      getWorkflowJob(ciWorkflow, 'e2e'),
      'Setup locked Node.js dependencies and Playwright browser',
    );

    expect(setupStep.uses).toBe(lockedInstallActionPath);
    expect(setupStep.with.get('install-browsers')).toBe('true');
    expect(setupStep.with.get('browser-name')).toBe('${{ matrix.install_args }}');
    expect(setupStep.with.get('cache-namespace')).toBe('e2e-${{ matrix.install_args }}');
  });

  it('covers every configured Playwright project exactly once across the matrix', () => {
    const laneProjects = (getWorkflowJob(ciWorkflow, 'e2e').strategy?.include ?? []).flatMap(
      (entry) => (entry.get('projects') ?? '').split(';'),
    );

    expect(
      [...laneProjects].sort(),
      'E2E matrix must run each Playwright project exactly once, WebKit projects grouped by binary.',
    ).toEqual(
      [
        'Firefox',
        'Google Chrome',
        'Microsoft Edge',
        'Mobile Chrome',
        'Mobile Safari',
        'Safari',
      ].sort(),
    );
    expectInvariant(
      new Set(laneProjects).size === laneProjects.length,
      'No Playwright project may appear in more than one matrix lane on the same event.',
    );
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
