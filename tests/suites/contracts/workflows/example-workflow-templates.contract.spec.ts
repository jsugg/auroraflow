import { describe, expect, it } from 'vitest';
import { expectEveryTextMatches, expectInvariant } from '../../../helpers/contractAssertions';
import {
  getWorkflowActionReferences,
  getWorkflowJob,
  getWorkflowStep,
  readWorkflowModel,
} from '../../../helpers/workflowModel';

const TEMPLATE_WORKFLOWS = [
  'examples/ci/quality.workflow.example.yml',
  'examples/ci/e2e-matrix.workflow.example.yml',
  'examples/ci/security.workflow.example.yml',
] as const;

describe('example workflow template contract', () => {
  it('keeps Node24 runtime opt-in and immutable action refs', () => {
    for (const templatePath of TEMPLATE_WORKFLOWS) {
      const workflow = readWorkflowModel(templatePath);

      expect(
        workflow.env.get('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'),
        `${templatePath} must opt JavaScript actions into Node 24.`,
      ).toBe('true');
      expectEveryTextMatches(
        getWorkflowActionReferences(workflow).filter((reference) => !reference.startsWith('./')),
        /^[^@]+@[a-f0-9]{40}$/,
        `${templatePath} must pin every external action to an immutable SHA.`,
      );
      expect(
        workflow.concurrency.get('cancel-in-progress'),
        `${templatePath} must define cancelable concurrency to bound CI fan-out.`,
      ).toBe('true');
      expectInvariant(
        [...workflow.jobs.values()].every((job) => job.timeoutMinutes !== undefined),
        `${templatePath} must put an explicit timeout on every job.`,
      );
    }
  });

  it('does not reference known deprecated Node20-target action SHAs', () => {
    const disallowedReferences = [
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830',
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
      'dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36',
    ];
    const disallowedReferenceSet = new Set<string>(disallowedReferences);

    for (const templatePath of TEMPLATE_WORKFLOWS) {
      for (const actionReference of getWorkflowActionReferences(readWorkflowModel(templatePath))) {
        expectInvariant(
          !disallowedReferenceSet.has(actionReference) &&
            !actionReference.startsWith('actions/dependency-review-action@'),
          `${templatePath} must avoid deprecated Node20-target action reference ${actionReference}.`,
        );
      }
    }
  });

  it('keeps quality template gates aligned with the static/Node-matrix split topology', () => {
    const workflow = readWorkflowModel('examples/ci/quality.workflow.example.yml');
    const nodeCompatJob = getWorkflowJob(workflow, 'node-compat');
    const staticJob = getWorkflowJob(workflow, 'static-analysis');

    expect(nodeCompatJob.name).toBe('Node Compatibility (Node ${{ matrix.node-version }})');
    expect(staticJob.name).toBe('Static Analysis (Node 22)');
    // The Node matrix exercises runtime-sensitive behavior only; runtime-insensitive
    // gates run once via `npm run verify` on the canonical Node 22 lane.
    expect(getWorkflowStep(nodeCompatJob, 'Run unit tests').run).toBe('npm test');
    expectInvariant(
      nodeCompatJob.steps.every(
        (step) => !step.run?.includes('lint') && !step.run?.includes('typecheck'),
      ),
      'Quality template Node matrix must not repeat lint/typecheck per Node version.',
    );
    expect(
      getWorkflowStep(staticJob, 'Run static analysis and repository gates').env.get(
        'AURORAFLOW_REDIS_INTEGRATION_REQUIRED',
      ),
    ).toBe('true');
    expectInvariant(
      staticJob.steps.every((step) => step.name !== 'Run verification contract'),
      'Quality template must use current static-analysis naming, not retired verification contract prose.',
    );
  });
});
