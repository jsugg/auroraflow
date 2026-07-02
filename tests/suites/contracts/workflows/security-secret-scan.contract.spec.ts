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
    // Match the analyzer command shape while requiring an immutable version pin (see the
    // dedicated pin test below) so this assertion can never drift back to unpinned.
    expectTextMatches(scripts['security:workflows'] ?? '', {
      pattern: /^pipx run .*\bzizmor==\d+\.\d+\.\d+\b.* \.github\/workflows$/u,
      rationale: 'Workflow analyzer must run a version-pinned zizmor against .github/workflows.',
    });
    expect(scripts['security:all']).toBe('npm run security:audit && npm run security:workflows');
    expect(scripts['security:check']).toBe('npm run security:all');
    expect(scripts['workflows:security']).toBe('npm run security:workflows');
  });

  it('pins the zizmor workflow analyzer to an immutable version like every other security tool', () => {
    // gitleaks is version+sha256 pinned and every action is SHA-pinned, but the zizmor
    // analyzer is invoked via an npm script and was the lone unpinned security tool. That
    // let a new upstream release silently add an audit and break this gate with no code
    // change on our side. Pinning keeps the gate reproducible: it can neither flap on a
    // newly introduced audit nor silently weaken if an audit is dropped upstream.
    expectTextMatches(scripts['security:workflows'] ?? '', {
      pattern: /\bzizmor==\d+\.\d+\.\d+\b/u,
      rationale:
        'Workflow analyzer must run a pinned zizmor version for reproducible, non-flapping gating.',
    });
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
    const securityGateRun =
      getWorkflowStep(securityGateJob, 'Enforce upstream security job results').run ?? '';

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
    expectTextIncludes(securityGateRun, {
      text: 'require_success "Secret Scan" "$SECRET_SCAN_RESULT"',
      rationale: 'Security gate must fail closed when secret scan does not succeed.',
    });
    expect(
      getWorkflowStep(securityGateJob, 'Enforce upstream security job results').env.get(
        'SECRET_SCAN_EFFECT_PROOF_RESULT',
      ),
    ).toBe('${{ needs.secret-scan-effect-proof.result }}');
    expectTextIncludes(securityGateRun, {
      text: 'require_success "Secret Scan Effect Proof" "$SECRET_SCAN_EFFECT_PROOF_RESULT"',
      rationale: 'Security gate must fail closed when the synthetic secret proof does not pass.',
    });
    expectTextIncludes(securityGateRun, {
      text: 'Security Gate failed closed because one or more required security jobs had an unexpected result.',
      rationale: 'Security gate must make unexpected skip/failure/cancelled states actionable.',
    });
  });

  it('runs CodeQL on pull requests without an unnecessary JavaScript autobuild', () => {
    const codeqlJob = getWorkflowJob(securityWorkflow, 'codeql');

    expect(codeqlJob.name).toBe('CodeQL');
    expect(codeqlJob.if).toBeUndefined();
    expectInvariant(
      !codeqlJob.steps.some((step) => step.uses?.startsWith('github/codeql-action/autobuild@')),
      'JavaScript/TypeScript CodeQL analysis must not run an unnecessary autobuild step.',
    );
    expectTextMatches(getWorkflowStep(codeqlJob, 'Perform CodeQL analysis').uses ?? '', {
      pattern: /^github\/codeql-action\/analyze@[a-f0-9]{40}$/u,
      rationale: 'CodeQL analysis action must stay pinned to an immutable SHA.',
    });
  });

  it('keeps full-lock npm audit skipped on pull requests and blocking on push/schedule', () => {
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
      text: 'require_skipped "NPM Audit" "$NPM_AUDIT_RESULT"',
      rationale: 'Security gate must verify npm audit is the only intentionally skipped PR job.',
    });
    expectTextIncludes(securityGateRun, {
      text: 'require_success "NPM Audit" "$NPM_AUDIT_RESULT"',
      rationale: 'Security gate must block failing npm audit only for trusted push/schedule runs.',
    });
    expectTextIncludes(securityGateRun, {
      text: 'require_success "CodeQL" "$CODEQL_RESULT"',
      rationale: 'Security gate must require CodeQL on pull requests, push, and schedule.',
    });
  });

  it('proves gitleaks catches a synthetic secret without weakening the pinned scan job', () => {
    const effectProofJob = getWorkflowJob(securityWorkflow, 'secret-scan-effect-proof');
    const installStep = getWorkflowStep(effectProofJob, 'Install pinned gitleaks');
    const assertionStep = getWorkflowStep(
      effectProofJob,
      'Assert the secret scanner detects a planted credential',
    );

    expect(effectProofJob.name).toBe('Secret Scan Effect Proof');

    const installRun = installStep.run ?? '';
    expectInvariant(
      installRun.includes('gitleaks/gitleaks/releases/download/') &&
        /version=\d+\.\d+\.\d+/.test(installRun),
      'Effect proof must install gitleaks from a version-pinned release asset.',
    );
    expectTextIncludes(installRun, {
      text: 'sha256sum -c',
      rationale: 'Effect proof must verify the downloaded gitleaks against a pinned checksum.',
    });

    const assertionRun = assertionStep.run ?? '';
    expectInvariant(
      assertionRun.includes('--no-git'),
      'Effect proof must scan the planted file directly, not a PR commit range that omits it.',
    );
    expectInvariant(
      assertionRun.includes('ghp_'),
      'Effect proof must plant a non-allowlisted synthetic token the scanner will flag.',
    );
    expectTextIncludes(assertionRun, {
      text: 'the gate may be ineffective',
      rationale: 'Effect proof must fail with an actionable scanner-ineffective message.',
    });

    const realScanStep = getWorkflowStep(
      getWorkflowJob(securityWorkflow, 'secret-scan'),
      'Run gitleaks scan',
    );
    expectInvariant(
      (realScanStep.uses ?? '').startsWith('gitleaks/gitleaks-action@'),
      'The enforced secret-scan job must keep using the pinned gitleaks action.',
    );
  });
});
