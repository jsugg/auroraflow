import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectEveryTextMatches,
  expectInvariant,
  expectTextIncludes,
  expectTextMatches,
} from '../../../helpers/contractAssertions';
import {
  getWorkflowActionReferences,
  getWorkflowJob,
  getWorkflowStep,
  readWorkflowModel,
} from '../../../helpers/workflowModel';

const securityWorkflow = readWorkflowModel('.github/workflows/security.yml');
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  readonly scripts?: Readonly<Record<string, string>>;
};
const scripts = packageJson.scripts ?? {};

describe('security workflow secret scanning contract', () => {
  it('splits security command ownership between dependency audit and workflow analysis', () => {
    expect(scripts['security:audit']).toBe('npm audit --audit-level=high');
    expect(scripts['security:workflows']).toBe('pipx run zizmor .github/workflows');
    expect(scripts['security:all']).toBe('npm run security:audit && npm run security:workflows');
    expect(scripts['security:check']).toBe('npm run security:all');
    expect(scripts['workflows:security']).toBe('npm run security:workflows');
  });

  it('pins every security workflow action to an immutable SHA', () => {
    expectEveryTextMatches(
      getWorkflowActionReferences(securityWorkflow).filter(
        (reference) => !reference.startsWith('./'),
      ),
      /^[^@]+@[a-f0-9]{40}$/,
      'Security workflow must pin every external action to an immutable SHA.',
    );
  });

  it('defines a dedicated gitleaks secret-scan job pinned to an immutable action SHA', () => {
    const secretScanJob = getWorkflowJob(securityWorkflow, 'secret-scan');

    expect(secretScanJob.name).toBe('Secret Scan (gitleaks)');
    expectTextMatches(getWorkflowStep(secretScanJob, 'Run gitleaks scan').uses ?? '', {
      pattern: /^gitleaks\/gitleaks-action@[a-f0-9]{40}$/u,
      rationale: 'Secret scan job must use gitleaks pinned to an immutable action SHA.',
    });
  });

  it('enforces secret scan results in Security Gate merge blocking logic', () => {
    const securityGateJob = getWorkflowJob(securityWorkflow, 'security-gate');

    expect(securityGateJob.needs).toEqual(
      expect.arrayContaining([
        'dependency-review',
        'npm-audit',
        'codeql',
        'secret-scan',
        'secret-scan-effect-proof',
      ]),
    );
    expect(
      getWorkflowStep(securityGateJob, 'Enforce upstream security job results').env.get(
        'SECRET_SCAN_RESULT',
      ),
    ).toBe('${{ needs.secret-scan.result }}');
    expectTextIncludes(
      getWorkflowStep(securityGateJob, 'Enforce upstream security job results').run ?? '',
      {
        text: 'Secret scan failed: $SECRET_SCAN_RESULT',
        rationale: 'Security gate must fail closed when secret scan does not succeed.',
      },
    );
    expect(
      getWorkflowStep(securityGateJob, 'Enforce upstream security job results').env.get(
        'SECRET_SCAN_EFFECT_PROOF_RESULT',
      ),
    ).toBe('${{ needs.secret-scan-effect-proof.result }}');
    expectTextIncludes(
      getWorkflowStep(securityGateJob, 'Enforce upstream security job results').run ?? '',
      {
        text: 'Secret scan effect proof failed: $SECRET_SCAN_EFFECT_PROOF_RESULT',
        rationale: 'Security gate must fail closed when the synthetic secret proof does not pass.',
      },
    );
  });

  it('keeps full-lock npm audit blocking on push and schedule, not pull requests', () => {
    const npmAuditJob = getWorkflowJob(securityWorkflow, 'npm-audit');
    const workflowSecurityJob = getWorkflowJob(securityWorkflow, 'workflow-security');
    const securityGateRun =
      getWorkflowStep(
        getWorkflowJob(securityWorkflow, 'security-gate'),
        'Enforce upstream security job results',
      ).run ?? '';

    expect(npmAuditJob.name).toBe('NPM Audit');
    expect(npmAuditJob.if).toBe("github.event_name != 'pull_request'");
    expect(getWorkflowStep(npmAuditJob, 'Run npm audit (high+)').run).toBe(
      'npm run security:audit',
    );
    expect(getWorkflowStep(workflowSecurityJob, 'Analyze workflows with zizmor').run).toBe(
      'npm run security:workflows',
    );
    expectInvariant(
      !getWorkflowStep(npmAuditJob, 'Run npm audit (high+)').run?.includes('zizmor'),
      'NPM audit job must not run workflow security scanning.',
    );
    expectTextIncludes(securityGateRun, {
      text: 'if [ "${{ github.event_name }}" != "pull_request" ] && [ "$NPM_AUDIT_RESULT" != "success" ]; then',
      rationale: 'Security gate must block failing npm audit only for trusted push/schedule runs.',
    });
  });

  it('proves gitleaks catches a synthetic secret without weakening the pinned scan job', () => {
    const effectProofJob = getWorkflowJob(securityWorkflow, 'secret-scan-effect-proof');
    const fixtureStep = getWorkflowStep(effectProofJob, 'Commit synthetic secret fixture');
    const syntheticScanStep = getWorkflowStep(
      effectProofJob,
      'Run gitleaks against synthetic secret',
    );
    const assertionStep = getWorkflowStep(effectProofJob, 'Assert synthetic secret was detected');

    expect(effectProofJob.name).toBe('Secret Scan Effect Proof');
    expect(syntheticScanStep.id).toBe('synthetic-gitleaks');
    expect(syntheticScanStep.uses).toBe(
      getWorkflowStep(getWorkflowJob(securityWorkflow, 'secret-scan'), 'Run gitleaks scan').uses,
    );
    expect(syntheticScanStep.continueOnError).toBe('true');
    expect(syntheticScanStep.env.get('GITLEAKS_ENABLE_UPLOAD_ARTIFACT')).toBe('false');
    expect(assertionStep.env.get('SYNTHETIC_GITLEAKS_OUTCOME')).toBe(
      '${{ steps.synthetic-gitleaks.outcome }}',
    );
    expectTextIncludes(fixtureStep.run ?? '', {
      text: 'git commit -m "synthetic secret scan proof"',
      rationale: 'Synthetic proof must place the planted secret into local git history.',
    });
    expectTextIncludes(assertionStep.run ?? '', {
      text: 'Synthetic gitleaks proof did not fail on planted secret; scanner may be disabled or misconfigured.',
      rationale: 'Synthetic proof must fail with an actionable scanner misconfiguration message.',
    });
  });
});
