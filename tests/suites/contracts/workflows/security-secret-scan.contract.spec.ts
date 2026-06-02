import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SECURITY_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/security.yml');
const securityWorkflow = readFileSync(SECURITY_WORKFLOW_PATH, 'utf8');

describe('security workflow secret scanning contract', () => {
  it('defines a dedicated gitleaks secret-scan job pinned to an immutable action SHA', () => {
    expect(securityWorkflow).toMatch(/\n\s+secret-scan:\n/);
    expect(securityWorkflow).toContain('name: Secret Scan (gitleaks)');
    expect(securityWorkflow).toMatch(/uses:\s+gitleaks\/gitleaks-action@[a-f0-9]{40}/);
  });

  it('enforces secret scan results in Security Gate merge blocking logic', () => {
    expect(securityWorkflow).toMatch(/needs:\n(?:\s+- .+\n)+\s+- secret-scan\n/);
    expect(securityWorkflow).toContain('SECRET_SCAN_RESULT: ${{ needs.secret-scan.result }}');
    expect(securityWorkflow).toContain('Secret scan failed: $SECRET_SCAN_RESULT');
  });

  it('keeps full-lock npm audit blocking on push and schedule, not pull requests', () => {
    expect(securityWorkflow).toMatch(
      /\n\s+npm-audit:\n\s+name: NPM Audit\n\s+if: github\.event_name != 'pull_request'\n/,
    );
    expect(securityWorkflow).toContain(
      'if [ "${{ github.event_name }}" != "pull_request" ] && [ "$NPM_AUDIT_RESULT" != "success" ]; then',
    );
  });
});
