import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const QUALITY_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/quality.yml');
const qualityWorkflow = readFileSync(QUALITY_WORKFLOW_PATH, 'utf8');

describe('self-healing governance workflow contract', () => {
  it('runs governance checks after smoke execution with explicit env controls', () => {
    expect(qualityWorkflow).toContain('- name: Evaluate self-healing governance');
    expect(qualityWorkflow).toContain('id: self-heal-governance');
    expect(qualityWorkflow).toContain('SELF_HEAL_ARTIFACTS_DIR: test-results/self-healing');
    expect(qualityWorkflow).toContain("SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED: 'true'");
    expect(qualityWorkflow).toContain('run: npm run self-heal:governance');
  });

  it('exposes governance outputs for downstream triage handling', () => {
    expect(qualityWorkflow).toContain('self_heal_triage_required');
    expect(qualityWorkflow).toContain('self_heal_guarded_accepted_count');
    expect(qualityWorkflow).toContain('steps.self-heal-governance.outputs.triage_required');
  });

  it('supports optional auto-triage issue creation with explicit opt-in', () => {
    expect(qualityWorkflow).toContain('- name: Auto-open self-healing triage issue');
    expect(qualityWorkflow).toContain("vars.SELF_HEAL_AUTO_OPEN_TRIAGE_ISSUE == 'true'");
    expect(qualityWorkflow).toContain('gh issue create');
  });
});
