import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const workflow = readWorkflowModel('.github/workflows/playwright-peer-matrix.yml');

describe('Playwright peer matrix workflow', () => {
  it('tests floor, lockfile-current, and latest supported 1.x lanes', () => {
    const peerMatrixJob = getWorkflowJob(workflow, 'peer-matrix');

    expect(
      peerMatrixJob.strategy?.include.map((entry) => ({
        lane: entry.get('lane'),
        versionSpec: entry.get('version_spec'),
      })),
      'Playwright compatibility matrix must cover floor, lockfile-current, and latest 1.x lanes.',
    ).toEqual([
      { lane: 'floor', versionSpec: '1.59.1' },
      { lane: 'current', versionSpec: '' },
      { lane: 'latest', versionSpec: '^1.59.0' },
    ]);
    expectTextIncludes(
      getWorkflowStep(peerMatrixJob, 'Verify installed Playwright version').run ?? '',
      {
        text: 'outside >=1.59 <2',
        rationale:
          'Peer matrix must fail loudly when resolved Playwright version leaves peer range.',
      },
    );
    expectTextIncludes(
      getWorkflowStep(peerMatrixJob, 'Install matrix Playwright version').run ?? '',
      {
        text: 'playwright-core@${PLAYWRIGHT_VERSION_SPEC}',
        rationale:
          'Peer matrix must keep playwright, playwright-core, and @playwright/test aligned.',
      },
    );
  });

  it('runs heavy browser coverage only on scheduled, manual, or release calls', () => {
    const peerMatrixJob = getWorkflowJob(workflow, 'peer-matrix');

    expect(
      [...workflow.triggers].sort(),
      'Peer matrix must stay off pull_request and run only by schedule, manual dispatch, or release workflow_call.',
    ).toEqual(['schedule', 'workflow_call', 'workflow_dispatch']);
    const peerInstallRun = getWorkflowStep(peerMatrixJob, 'Install Playwright Chrome').run ?? '';
    expectTextIncludes(peerInstallRun, {
      text: 'timeout 300 npx playwright install --with-deps chrome',
      rationale:
        'Peer matrix must install Chrome under a bounded per-attempt timeout so network hangs fail fast instead of consuming the job budget.',
    });
    expectTextIncludes(peerInstallRun, {
      text: 'for attempt in 1 2 3',
      rationale:
        'Peer matrix browser install must retry to absorb transient registry/apt failures.',
    });
    expect(
      getWorkflowStep(peerMatrixJob, 'Cache Playwright Chrome').with.get('restore-keys'),
      'Peer matrix browser cache must fall back to a lane-scoped prefix so unrelated changes reuse Chrome instead of cold-downloading.',
    ).toBe('${{ runner.os }}-playwright-peer-${{ matrix.lane }}-');
    expect(getWorkflowStep(peerMatrixJob, 'Run Chrome smoke suite').run).toBe('npm run test:smoke');
  });

  it('keeps compatibility scope focused and bounded', () => {
    const peerMatrixJob = getWorkflowJob(workflow, 'peer-matrix');

    expect(peerMatrixJob.timeoutMinutes).toBe(20);
    expect(peerMatrixJob.strategy?.maxParallel).toBe(2);
    expect(getWorkflowStep(peerMatrixJob, 'Run compatibility typecheck').run).toBe(
      'npm run typecheck',
    );
    expectTextIncludes(
      getWorkflowStep(peerMatrixJob, 'Run focused compatibility unit tests').run ?? '',
      {
        text: 'pageObjectBase.spec.ts',
        rationale:
          'Peer matrix must focus on public compatibility units instead of full E2E breadth.',
      },
    );
    expectInvariant(
      peerMatrixJob.steps.every((step) => step.run !== 'npm run test:e2e'),
      'Peer matrix must not run full E2E; smoke suite is the bounded browser proof.',
    );
  });
});
