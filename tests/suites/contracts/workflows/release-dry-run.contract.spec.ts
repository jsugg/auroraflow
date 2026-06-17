import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectEveryTextMatches,
  expectInvariant,
  expectTextIncludes,
} from '../../../helpers/contractAssertions';
import {
  getWorkflowActionReferences,
  getWorkflowJob,
  getWorkflowStep,
  readWorkflowModel,
} from '../../../helpers/workflowModel';

const releaseWorkflowModel = readWorkflowModel('.github/workflows/release.yml');

const RELEASE_PROCESS_DOC_PATH = path.join(process.cwd(), 'docs/operations/release-process.md');
const releaseProcessDoc = readFileSync(RELEASE_PROCESS_DOC_PATH, 'utf8');

describe('release dry-run workflow contract', () => {
  it('triggers only on manual workflow_dispatch', () => {
    expect(
      [...releaseWorkflowModel.triggers],
      'Release dry-run workflow must only run after explicit maintainer dispatch.',
    ).toEqual(['workflow_dispatch']);
  });

  it('declares least-privilege read-only permissions at workflow and job level', () => {
    expect(releaseWorkflowModel.permissions.get('contents')).toBe('read');
    expect(
      getWorkflowJob(releaseWorkflowModel, 'release-dry-run').permissions.get('contents'),
    ).toBe('read');
    expect(getWorkflowJob(releaseWorkflowModel, 'publish-gate').permissions.get('contents')).toBe(
      'read',
    );
    expectInvariant(
      [
        releaseWorkflowModel.permissions,
        ...[...releaseWorkflowModel.jobs.values()].map((job) => job.permissions),
      ].every((permissions) => ![...permissions.values()].includes('write')),
      'Release dry-run workflow must not grant write permissions until publish path is implemented.',
    );
  });

  it('never invokes npm publish and keeps packaging in dry-run mode', () => {
    const releaseJob = getWorkflowJob(releaseWorkflowModel, 'release-dry-run');
    const runCommands = releaseJob.steps.flatMap((step) =>
      step.run === undefined ? [] : [step.run],
    );

    expectInvariant(
      runCommands.every((runCommand) => !runCommand.includes('npm publish')),
      'Release dry-run workflow must not publish packages.',
    );
    const dryRunPackCommand = getWorkflowStep(releaseJob, 'Dry-run package tarball').run ?? '';
    expectInvariant(
      dryRunPackCommand.includes('npm run pack:dry-run'),
      'Release workflow must keep npm package generation in dry-run mode.',
    );
    expectInvariant(
      dryRunPackCommand.includes('npm pack --dry-run --json'),
      'Release workflow must emit dry-run pack evidence without publishing.',
    );
  });

  it('pins every action to an immutable SHA and disables credential persistence', () => {
    expectEveryTextMatches(
      getWorkflowActionReferences(releaseWorkflowModel).filter(
        (reference) => !reference.startsWith('./'),
      ),
      /^[^@]+@[a-f0-9]{40}$/,
      'Release dry-run workflow must pin every external action to an immutable SHA.',
    );
    expect(
      getWorkflowStep(getWorkflowJob(releaseWorkflowModel, 'release-dry-run'), 'Checkout').with.get(
        'persist-credentials',
      ),
    ).toBe('false');
  });

  it('produces verify, schema, build, pack, SBOM, provenance, and changelog evidence', () => {
    const releaseJob = getWorkflowJob(releaseWorkflowModel, 'release-dry-run');

    expect(getWorkflowStep(releaseJob, 'Run quality gates').run).toBe('npm run verify');
    expectInvariant(
      (getWorkflowStep(releaseJob, 'Validate artifact schemas').run ?? '').includes(
        'npm run schemas:check 2>&1 | tee release-evidence/schema-validation.txt',
      ),
      'Release dry-run evidence must tee schema validation output into the evidence bundle.',
    );
    expect(getWorkflowStep(releaseJob, 'Build package').run).toBe('npm run build');
    const sbomCommand =
      getWorkflowStep(releaseJob, 'Generate SBOMs (runtime dependencies)').run ?? '';
    expectInvariant(
      sbomCommand.includes('npm sbom --omit dev --sbom-format spdx') &&
        sbomCommand.includes('npm sbom --omit dev --sbom-format cyclonedx'),
      'Release dry-run evidence must include SPDX and CycloneDX runtime SBOMs.',
    );
    expectInvariant(
      (getWorkflowStep(releaseJob, 'Check npm provenance readiness').run ?? '').includes(
        'release-evidence/provenance-readiness.txt',
      ),
      'Release dry-run evidence must record npm provenance readiness checks.',
    );
    expectInvariant(
      (getWorkflowStep(releaseJob, 'Draft changelog from Conventional Commits').run ?? '').includes(
        'release-evidence/changelog-draft.md',
      ),
      'Release dry-run evidence must include a Conventional Commits changelog draft.',
    );
    expect(getWorkflowStep(releaseJob, 'Upload release evidence').with.get('name')).toBe(
      'release-dry-run-evidence',
    );
  });

  it('gates the publish placeholder behind a confirmation input, protected environment, and hard refusal', () => {
    const publishGate = getWorkflowJob(releaseWorkflowModel, 'publish-gate');

    expect(publishGate.if).toBe("inputs.publish_confirmation != ''");
    expect(publishGate.environment).toBe('release');
    expect(getWorkflowStep(publishGate, 'Refuse to publish').run?.split('\n').at(-1)).toBe(
      'exit 1',
    );
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
      expectTextIncludes(releaseProcessDoc, {
        text: term,
        rationale: 'Release process doc must preserve public release-safety policy wording.',
      });
    }
  });

  it('states that publishing is disabled and gated by the protected release environment', () => {
    for (const text of ['never publishes', '`release` environment', 'publish_confirmation']) {
      expectTextIncludes(releaseProcessDoc, {
        text,
        rationale: 'Release process doc must warn maintainers that publishing remains disabled.',
      });
    }
  });
});
