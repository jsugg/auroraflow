import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const RELEASE_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/release.yml');
const releaseWorkflow = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8');
const releaseWorkflowModel = readWorkflowModel('.github/workflows/release.yml');

const RELEASE_PROCESS_DOC_PATH = path.join(process.cwd(), 'docs/operations/release-process.md');
const releaseProcessDoc = readFileSync(RELEASE_PROCESS_DOC_PATH, 'utf8');

describe('release dry-run workflow contract', () => {
  it('triggers only on manual workflow_dispatch', () => {
    expect(releaseWorkflow).toMatch(/\non:\n {2}workflow_dispatch:\n/);
    expect(releaseWorkflow).not.toMatch(/\n\s+push:/);
    expect(releaseWorkflow).not.toMatch(/\n\s+pull_request:/);
    expect(releaseWorkflow).not.toMatch(/\n\s+schedule:/);
    expect(releaseWorkflow).not.toMatch(/\n\s+release:\n/);
  });

  it('declares least-privilege read-only permissions at workflow and job level', () => {
    expect(releaseWorkflowModel.permissions.get('contents')).toBe('read');
    expect(
      getWorkflowJob(releaseWorkflowModel, 'release-dry-run').permissions.get('contents'),
    ).toBe('read');
    expect(getWorkflowJob(releaseWorkflowModel, 'publish-gate').permissions.get('contents')).toBe(
      'read',
    );
    expect(releaseWorkflow).not.toMatch(/^\s*[\w-]+:\s*write\s*$/m);
  });

  it('never invokes npm publish and keeps packaging in dry-run mode', () => {
    expect(releaseWorkflow).not.toContain('npm publish');
    expect(releaseWorkflow).toContain('npm run pack:dry-run');
    expect(releaseWorkflow).toContain('npm pack --dry-run --json');
  });

  it('pins every action to an immutable SHA and disables credential persistence', () => {
    const usesEntries = (releaseWorkflow.match(/uses:\s+\S+/g) ?? []).filter(
      (usesEntry) => !usesEntry.startsWith('uses: ./'),
    );
    expect(usesEntries.length).toBeGreaterThan(0);
    for (const usesEntry of usesEntries) {
      expect(usesEntry).toMatch(/@[a-f0-9]{40}$/);
    }
    expect(
      getWorkflowStep(getWorkflowJob(releaseWorkflowModel, 'release-dry-run'), 'Checkout').with.get(
        'persist-credentials',
      ),
    ).toBe('false');
  });

  it('produces verify, schema, build, pack, SBOM, provenance, and changelog evidence', () => {
    const releaseJob = getWorkflowJob(releaseWorkflowModel, 'release-dry-run');

    expect(getWorkflowStep(releaseJob, 'Run quality gates').run).toBe('npm run verify');
    expect(getWorkflowStep(releaseJob, 'Validate artifact schemas').run).toContain(
      'npm run schemas:check 2>&1 | tee release-evidence/schema-validation.txt',
    );
    expect(getWorkflowStep(releaseJob, 'Build package').run).toBe('npm run build');
    expect(getWorkflowStep(releaseJob, 'Dry-run package tarball').run).toContain(
      'npm run pack:dry-run',
    );
    expect(getWorkflowStep(releaseJob, 'Generate SBOMs (runtime dependencies)').run).toContain(
      'npm sbom --omit dev --sbom-format spdx',
    );
    expect(getWorkflowStep(releaseJob, 'Generate SBOMs (runtime dependencies)').run).toContain(
      'npm sbom --omit dev --sbom-format cyclonedx',
    );
    expect(getWorkflowStep(releaseJob, 'Check npm provenance readiness').run).toContain(
      'release-evidence/provenance-readiness.txt',
    );
    expect(getWorkflowStep(releaseJob, 'Draft changelog from Conventional Commits').run).toContain(
      'release-evidence/changelog-draft.md',
    );
    expect(getWorkflowStep(releaseJob, 'Upload release evidence').with.get('name')).toBe(
      'release-dry-run-evidence',
    );
  });

  it('gates the publish placeholder behind a confirmation input, protected environment, and hard refusal', () => {
    const publishGate = getWorkflowJob(releaseWorkflowModel, 'publish-gate');

    expect(publishGate.if).toBe("inputs.publish_confirmation != ''");
    expect(publishGate.environment).toBe('release');
    expect(getWorkflowStep(publishGate, 'Refuse to publish').run).toContain('exit 1');
  });
});

describe('release process documentation contract', () => {
  it('documents changelog, rollback, provenance, SBOM, and deferred signing per AUR-DEC-012', () => {
    expect(releaseProcessDoc.trim().length).toBeGreaterThan(200);
    const requiredPolicyTerms = [
      'AUR-DEC-012',
      'Conventional Commits',
      'SemVer',
      'npm sbom',
      'schema-validation.txt',
      'provenance',
      'signing',
      'Rollback policy',
      'npm deprecate',
      'workflow_dispatch',
    ];
    for (const term of requiredPolicyTerms) {
      expect(releaseProcessDoc).toContain(term);
    }
  });

  it('states that publishing is disabled and gated by the protected release environment', () => {
    expect(releaseProcessDoc).toContain('never publishes');
    expect(releaseProcessDoc).toContain('`release` environment');
    expect(releaseProcessDoc).toContain('publish_confirmation');
  });
});
