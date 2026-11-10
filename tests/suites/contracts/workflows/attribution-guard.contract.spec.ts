import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectInvariant,
  expectTextExcludes,
  expectTextIncludes,
  expectTextNotMatches,
} from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const WORKFLOW_PATH = '.github/workflows/attribution-guard.yml';
const workflow = readWorkflowModel(WORKFLOW_PATH);
const guardJob = getWorkflowJob(workflow, 'attribution-guard');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function hookLines(relativePath: string): readonly string[] {
  return readRepoFile(relativePath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe('attribution guard workflow contract', () => {
  it('publishes a stable, unconditional Attribution Guard status', () => {
    expect(guardJob.name, 'Branch protection requires the exact check name.').toBe(
      'Attribution Guard',
    );
    expect(
      guardJob.if,
      'The guard must never end skipped or neutral; it runs on every triggering event.',
    ).toBeUndefined();
    expect([...workflow.jobs.keys()]).toEqual(['attribution-guard']);
  });

  it('re-evaluates on PR metadata events and audits pushes to main', () => {
    expect([...workflow.triggers].sort()).toEqual(['pull_request', 'push']);
    expectTextIncludes(workflow.raw, {
      text: 'types: [opened, reopened, synchronize, edited, labeled, unlabeled, ready_for_review]',
      rationale:
        'Title/body edits and label changes must re-run the required check without a new commit.',
    });
    expectTextIncludes(workflow.raw, {
      text: 'push:\n    branches: [main]',
      rationale: 'Merged commits are audited post-merge on main.',
    });
    expectTextExcludes(workflow.raw, {
      text: 'pull_request_target',
      rationale: 'The guard must never run pull request code with a privileged token.',
    });
    expectTextNotMatches(workflow.raw, {
      pattern: /^\s*paths(?:-ignore)?:/m,
      rationale: 'Path filters would let a PR skip the required check.',
    });
  });

  it('runs read-only with non-persisted credentials', () => {
    expect(Object.fromEntries(workflow.permissions)).toEqual({ contents: 'read' });
    expect(Object.fromEntries(guardJob.permissions)).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
    for (const stepName of ['Checkout trusted base', 'Checkout candidate']) {
      expect(
        getWorkflowStep(guardJob, stepName).with.get('persist-credentials'),
        `${stepName} must not leave a token in the workspace.`,
      ).toBe('false');
    }
  });

  it('judges pull requests with the base-commit helper and bootstraps only when absent', () => {
    expectTextIncludes(getWorkflowStep(guardJob, 'Checkout trusted base').with.get('ref') ?? '', {
      text: 'github.event.pull_request.base.sha',
      rationale: 'A pull request must not be able to weaken the guard that judges it.',
    });
    const run = getWorkflowStep(
      guardJob,
      'Check refs, labels, PR text, and commits for attribution',
    ).run;
    expectTextIncludes(run ?? '', {
      text: 'helper=trusted/scripts/attribution-guard.mjs',
      rationale: 'The trusted base helper is the default judge.',
    });
    expectTextIncludes(run ?? '', {
      text: 'if [ ! -f "${helper}" ]; then',
      rationale: 'The candidate helper is a bootstrap fallback only when the base predates it.',
    });
    expectTextIncludes(run ?? '', {
      text: 'node "${helper}" github',
      rationale: 'The guard refetches PR and commit data through the API in github mode.',
    });
  });
});

describe('attribution guard local hooks contract', () => {
  it('checks commit messages before commitlint', () => {
    expect(hookLines('.husky/commit-msg')).toEqual([
      'node scripts/attribution-guard.mjs commit-msg "$1"',
      'npx commitlint --edit "$1"',
    ]);
  });

  it('checks pushed refs and introduced commits before the verify-stamp gate', () => {
    const lines = hookLines('.husky/pre-push');
    expect(lines).toEqual([
      'node scripts/attribution-guard.mjs pre-push "$1"',
      'node scripts/verify-stamp.mjs pre-push',
    ]);
    expectInvariant(
      lines.indexOf('node scripts/attribution-guard.mjs pre-push "$1"') === 0,
      'The attribution guard must consume the pre-push ref list on stdin before other hooks run.',
    );
  });
});
