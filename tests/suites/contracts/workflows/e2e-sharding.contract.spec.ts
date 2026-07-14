import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const ciWorkflow = readWorkflowModel('.github/workflows/ci.yml');

describe('ci.yml e2e matrix topology contract', () => {
  it('runs one job per installed browser binary with no per-run sharding', () => {
    const e2eJob = getWorkflowJob(ciWorkflow, 'e2e');

    // Two-way sharding was removed: measured shard wall-clock was dominated by
    // browser/dependency setup, not test time, so sharding only doubled setup.
    expectInvariant(
      e2eJob.strategy?.matrix.get('shard') === undefined,
      'Full E2E matrix must not shard: Playwright is already parallel and setup dominates.',
    );
    expect(
      getWorkflowStep(e2eJob, 'Run full E2E suite').run?.includes('--shard'),
      'Full E2E runner must not pass a Playwright shard argument.',
    ).toBeFalsy();

    const lanes = (e2eJob.strategy?.include ?? []).map((entry) => ({
      lane: entry.get('lane'),
      installArgs: entry.get('install_args'),
      slug: entry.get('slug'),
      projects: entry.get('projects'),
    }));
    expect(
      lanes,
      'Full E2E matrix must map one job per browser binary and group desktop+mobile WebKit.',
    ).toEqual([
      {
        lane: 'Google Chrome',
        installArgs: 'chrome',
        slug: 'google-chrome',
        projects: 'Google Chrome',
      },
      { lane: 'Firefox', installArgs: 'firefox', slug: 'firefox', projects: 'Firefox' },
      {
        lane: 'Microsoft Edge',
        installArgs: 'msedge',
        slug: 'microsoft-edge',
        projects: 'Microsoft Edge',
      },
      {
        lane: 'Mobile Chrome',
        installArgs: 'chromium',
        slug: 'mobile-chrome',
        projects: 'Mobile Chrome',
      },
      {
        lane: 'WebKit (Safari + Mobile Safari)',
        installArgs: 'webkit',
        slug: 'webkit',
        projects: 'Safari;Mobile Safari',
      },
    ]);
  });

  it('groups the two WebKit projects into a single webkit install without losing project results', () => {
    const runStep = getWorkflowStep(getWorkflowJob(ciWorkflow, 'e2e'), 'Run full E2E suite');

    expectTextIncludes(runStep.run ?? '', {
      text: "IFS=';' read -ra projects",
      rationale:
        'Multi-project WebKit lane must split its project list safely for names with spaces.',
    });
    expectTextIncludes(runStep.run ?? '', {
      text: 'args+=(--project "${project}")',
      rationale:
        'Each configured project must be passed as its own quoted Playwright --project flag.',
    });
  });

  it('uses binary-scoped artifact and JSON names to avoid collisions', () => {
    const e2eJob = getWorkflowJob(ciWorkflow, 'e2e');

    expect(
      getWorkflowStep(e2eJob, 'Run full E2E suite').env.get('PLAYWRIGHT_JSON_OUTPUT_FILE'),
      'E2E matrix must emit binary-scoped JSON for flakiness aggregation.',
    ).toBe('test-results/playwright-results-${{ matrix.slug }}.json');
    expect(
      getWorkflowStep(e2eJob, 'Upload E2E artifacts').with.get('name'),
      'Uploaded E2E artifacts must be binary-scoped to avoid matrix collisions.',
    ).toBe('e2e-matrix-artifacts-${{ matrix.slug }}');
  });

  it('runs the exhaustive matrix on a daily schedule and dispatch, not on every main push', () => {
    expect(
      [...ciWorkflow.triggers].sort(),
      'E2E matrix must be a scheduled/manual daily workflow, not a per-push gate.',
    ).toEqual(['schedule', 'workflow_dispatch']);
    expectInvariant(
      !ciWorkflow.triggers.has('push'),
      'Full cross-browser matrix must not run on every main push; post-merge Chrome runs in Quality Gates.',
    );
  });
});
