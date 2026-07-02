import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const qualityWorkflow = readWorkflowModel('.github/workflows/quality.yml');
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const mutationDoc = readFileSync(
  path.join(process.cwd(), 'docs/quality/mutation-property-baseline.md'),
  'utf8',
);

describe('mutation baseline advisory workflow contract', () => {
  it('runs mutation comparison only on scheduled or manual evidence lanes', () => {
    const job = getWorkflowJob(qualityWorkflow, 'mutation-baseline');
    const setupStep = getWorkflowStep(job, 'Setup locked Node.js dependencies');

    expect(job.name).toBe('Mutation Baseline (Advisory)');
    expect(job.if).toBe(
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );
    expect(job.timeoutMinutes).toBe(20);
    expect(job.permissions.get('contents')).toBe('read');
    expect(setupStep.uses).toBe('./.github/actions/setup-node-cache');
    expect(setupStep.with.get('node-version')).toBe('22');
    expect(setupStep.with.get('cache-namespace')).toBe('mutation-baseline');
  });

  it('fails the evidence lane on regression and uploads its diagnostics', () => {
    const job = getWorkflowJob(qualityWorkflow, 'mutation-baseline');
    const checkStep = getWorkflowStep(job, 'Check mutation baseline');
    const uploadStep = getWorkflowStep(job, 'Upload mutation baseline evidence');

    expectTextIncludes(checkStep.run ?? '', {
      text: 'set -o pipefail',
      rationale: 'Mutation evidence must preserve the baseline command exit status through tee.',
    });
    expectTextIncludes(checkStep.run ?? '', {
      text: 'npm run test:mutation:check 2>&1 | tee mutation-output/baseline-check.txt',
      rationale: 'Mutation advisory lane must persist the exact no-regression gate output.',
    });
    expect(uploadStep.if).toBe('always()');
    expect(uploadStep.uses).toBe(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(uploadStep.with.get('path')).toBe('mutation-output/baseline-check.txt');
    expect(uploadStep.with.get('retention-days')).toBe('14');
  });

  it('keeps mutation checks outside required verify and documents source-drift failure', () => {
    expectInvariant(
      !packageJson.scripts.verify?.includes('test:mutation'),
      'Mutation baseline must remain outside the required verify path.',
    );
    expectTextIncludes(mutationDoc, {
      text: 'killed mutant now survives or becomes inapplicable',
      rationale: 'Mutation policy must treat source drift as a no-regression failure.',
    });
    expectTextIncludes(mutationDoc, {
      text: 'Mutation Baseline (Advisory)',
      rationale: 'Mutation policy must identify the scheduled/manual evidence lane as advisory.',
    });
  });
});
