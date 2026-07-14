import { describe, expect, it } from 'vitest';
import { expectTextIncludes } from '../../../helpers/contractAssertions';
import {
  getWorkflowJob,
  getWorkflowStep,
  getWorkflowStepById,
  readWorkflowModel,
} from '../../../helpers/workflowModel';

const qualityWorkflow = readWorkflowModel('.github/workflows/quality.yml');

describe('self-healing governance workflow contract', () => {
  it('runs governance checks after smoke execution with explicit env controls', () => {
    const governanceStep = getWorkflowStep(
      getWorkflowJob(qualityWorkflow, 'e2e-chrome'),
      'Evaluate self-healing governance',
    );

    expect(governanceStep.id).toBe('self-heal-governance');
    expect(governanceStep.env.get('SELF_HEAL_ARTIFACTS_DIR')).toBe('test-results/self-healing');
    expect(governanceStep.env.get('SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED')).toBe('true');
    expect(governanceStep.run).toBe('npm run self-heal:governance');
  });

  it('exposes governance outputs for downstream triage handling', () => {
    const smokeJob = getWorkflowJob(qualityWorkflow, 'e2e-chrome');

    expect(getWorkflowStepById(smokeJob, 'self-heal-governance').name).toBe(
      'Evaluate self-healing governance',
    );
    expect(smokeJob.outputs.get('self_heal_triage_required')).toBe(
      '${{ steps.self-heal-governance.outputs.triage_required }}',
    );
    expect(smokeJob.outputs.get('self_heal_guarded_accepted_count')).toBe(
      '${{ steps.self-heal-governance.outputs.guarded_accepted_count }}',
    );
  });

  it('supports optional auto-triage issue creation with explicit opt-in', () => {
    const triageStep = getWorkflowStep(
      getWorkflowJob(qualityWorkflow, 'e2e-chrome'),
      'Auto-open self-healing triage issue',
    );

    expectTextIncludes(triageStep.if ?? '', {
      text: "vars.SELF_HEAL_AUTO_OPEN_TRIAGE_ISSUE == 'true'",
      rationale: 'Self-healing issue creation must require explicit repository opt-in.',
    });
    expectTextIncludes(triageStep.run ?? '', {
      text: 'gh issue create',
      rationale:
        'Self-healing auto-triage must create an issue only after governance flags triage.',
    });
  });
});
