import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/ci.yml');
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

describe('ci.yml SLO dashboard and alerting contract', () => {
  it('defines a dedicated SLO dashboard and alerts job after flakiness aggregation', () => {
    expect(ciWorkflow).toContain('slo-dashboard:');
    expect(ciWorkflow).toContain('name: SLO Dashboard and Alerts');
    expect(ciWorkflow).toContain('needs: flakiness-report');
  });

  it('generates dashboard and alert artifacts with repository policy config', () => {
    expect(ciWorkflow).toContain('run: npm run slo:dashboard --');
    expect(ciWorkflow).toContain('npm run slo:alerts --');
    expect(ciWorkflow).toContain('configs/quality/slo-alert-policy.json');
    expect(ciWorkflow).toContain('name: slo-dashboard-alerts');
  });
});
