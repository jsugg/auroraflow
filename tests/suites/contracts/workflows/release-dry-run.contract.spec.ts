import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RELEASE_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/release.yml');
const releaseWorkflow = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8');

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
    expect(releaseWorkflow).toMatch(/\npermissions:\n {2}contents: read\n/);
    const jobPermissionBlocks = releaseWorkflow.match(/\n {4}permissions:\n {6}contents: read\n/g);
    expect(jobPermissionBlocks).toHaveLength(2);
    expect(releaseWorkflow).not.toMatch(/^\s*[\w-]+:\s*write\s*$/m);
  });

  it('never invokes npm publish and keeps packaging in dry-run mode', () => {
    expect(releaseWorkflow).not.toContain('npm publish');
    expect(releaseWorkflow).toContain('npm run pack:dry-run');
    expect(releaseWorkflow).toContain('npm pack --dry-run --json');
  });

  it('pins every action to an immutable SHA and disables credential persistence', () => {
    const usesEntries = releaseWorkflow.match(/uses:\s+\S+/g) ?? [];
    expect(usesEntries.length).toBeGreaterThan(0);
    for (const usesEntry of usesEntries) {
      expect(usesEntry).toMatch(/@[a-f0-9]{40}$/);
    }
    expect(releaseWorkflow).toContain('persist-credentials: false');
  });

  it('produces verify, build, pack, SBOM, provenance-readiness, and changelog evidence', () => {
    expect(releaseWorkflow).toContain('run: npm run verify');
    expect(releaseWorkflow).toContain('run: npm run build');
    expect(releaseWorkflow).toContain('npm sbom --omit dev --sbom-format spdx');
    expect(releaseWorkflow).toContain('npm sbom --omit dev --sbom-format cyclonedx');
    expect(releaseWorkflow).toContain('release-evidence/provenance-readiness.txt');
    expect(releaseWorkflow).toContain('release-evidence/changelog-draft.md');
    expect(releaseWorkflow).toContain('name: release-dry-run-evidence');
  });

  it('gates the publish placeholder behind a confirmation input, protected environment, and hard refusal', () => {
    expect(releaseWorkflow).toMatch(/\n {2}publish-gate:\n/);
    expect(releaseWorkflow).toContain("if: inputs.publish_confirmation != ''");
    expect(releaseWorkflow).toContain('environment: release');
    expect(releaseWorkflow).toMatch(/Refuse to publish[\s\S]+?exit 1/);
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
