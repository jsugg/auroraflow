import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const securityWorkflow = readWorkflowModel('.github/workflows/security.yml');

describe('security workflow secret scanning contract', () => {
  it('defines a dedicated gitleaks secret-scan job pinned to an immutable action SHA', () => {
    const secretScanJob = getWorkflowJob(securityWorkflow, 'secret-scan');

    expect(secretScanJob.name).toBe('Secret Scan (gitleaks)');
    expectInvariant(
      /^gitleaks\/gitleaks-action@[a-f0-9]{40}$/u.test(
        getWorkflowStep(secretScanJob, 'Run gitleaks scan').uses ?? '',
      ),
      'Secret scan job must use gitleaks pinned to an immutable action SHA.',
    );
  });

  it('enforces secret scan results in Security Gate merge blocking logic', () => {
    const securityGateJob = getWorkflowJob(securityWorkflow, 'security-gate');

    expect(securityGateJob.needs).toEqual(
      expect.arrayContaining(['dependency-review', 'npm-audit', 'codeql', 'secret-scan']),
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
  });

  it('keeps full-lock npm audit blocking on push and schedule, not pull requests', () => {
    const npmAuditJob = getWorkflowJob(securityWorkflow, 'npm-audit');
    const securityGateRun =
      getWorkflowStep(
        getWorkflowJob(securityWorkflow, 'security-gate'),
        'Enforce upstream security job results',
      ).run ?? '';

    expect(npmAuditJob.name).toBe('NPM Audit');
    expect(npmAuditJob.if).toBe("github.event_name != 'pull_request'");
    expectTextIncludes(securityGateRun, {
      text: 'if [ "${{ github.event_name }}" != "pull_request" ] && [ "$NPM_AUDIT_RESULT" != "success" ]; then',
      rationale: 'Security gate must block failing npm audit only for trusted push/schedule runs.',
    });
  });
});
