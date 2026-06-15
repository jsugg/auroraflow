import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('documentation surface contract', () => {
  it('ships API-grade onboarding and reference docs', () => {
    const requiredDocs = [
      'CONTRIBUTING.md',
      'docs/getting-started.md',
      'docs/writing-tests.md',
      'docs/configuration.md',
      'docs/api.md',
      'docs/adr/README.md',
      'docs/adr/0001-safety-first-self-healing.md',
      'docs/adr/0002-api-stability-tiers.md',
      'docs/adr/0003-scoring-and-slo-policy.md',
      'docs/adr/0004-redis-strategy.md',
      'docs/adr/0005-observability-boundary.md',
      'docs/adr/0006-release-policy.md',
      'docs/architecture/self-healing.md',
      'docs/operations/privacy-retention.md',
      'docs/operations/observability-contract.md',
      'docs/operations/flakiness-analytics.md',
      'docs/operations/slo-dashboard-alerting.md',
    ];

    for (const docPath of requiredDocs) {
      expect(readRepoFile(docPath).trim().length).toBeGreaterThan(200);
    }
  });

  it('documents privacy scope, capture controls, and consumer-owned retention', () => {
    const privacy = readRepoFile('docs/operations/privacy-retention.md');

    for (const dataClass of [
      'Screenshots',
      'DOM text',
      'Failure events',
      'Logs',
      'Redis records',
      'Telemetry',
      'Trends',
      'Audit records',
    ]) {
      expect(privacy).toContain(dataClass);
    }
    expect(privacy).toContain('AURORAFLOW_ARTIFACT_PRIVACY_PRESET');
    expect(privacy).toContain('consumer-owned');
    expect(privacy).toContain('does not claim support for regulated PII');
  });

  it('keeps current maturity claims aligned with implemented promotion workflows', () => {
    const docs = [
      'README.md',
      'docs/development.md',
      'docs/architecture/self-healing.md',
      'docs/api.md',
    ]
      .map(readRepoFile)
      .join('\n');

    expect(docs).toContain('reviewable pending promotion records');
    expect(docs).toContain('approve, reject, conflict, and rollback workflows');
    expect(docs).toContain('source-code rewrites remain out of scope');
    expect(docs).not.toContain('not active persistence workflows');
    expect(docs).not.toContain('SAT history and promotion logic are not wired to Redis yet');
    expect(docs).not.toContain(
      'reviewed approval/rejection/rollback flows and source-code rewrites remain out of scope',
    );
  });

  it('documents lightweight contribution governance and advisory ownership', () => {
    const contributing = readRepoFile('CONTRIBUTING.md');
    const codeowners = readRepoFile('.github/CODEOWNERS');
    const adrIndex = readRepoFile('docs/adr/README.md');
    const adrDocs = [
      'docs/adr/0001-safety-first-self-healing.md',
      'docs/adr/0002-api-stability-tiers.md',
      'docs/adr/0003-scoring-and-slo-policy.md',
      'docs/adr/0004-redis-strategy.md',
      'docs/adr/0005-observability-boundary.md',
      'docs/adr/0006-release-policy.md',
    ]
      .map(readRepoFile)
      .join('\n');

    expect(contributing).toContain('lightweight');
    expect(contributing).toContain('advisory CODEOWNERS');
    expect(contributing).toContain('Confirm or replace owner handles');
    expect(codeowners).toContain('Advisory owner map');
    expect(codeowners).toContain('@jsugg');
    expect(adrIndex).toContain('ADR 0001');

    for (const topic of [
      'Safety-first self-healing',
      'API stability tiers',
      'Scoring and SLO policy',
      'Redis strategy',
      'Observability boundary',
      'Release policy',
    ]) {
      expect(adrDocs).toContain(topic);
    }

    for (const issueId of [
      'AUR-ARCH-034',
      'AUR-ARCH-035',
      'AUR-ARCH-009',
      'AUR-ARCH-040',
      'AUR-ARCH-041',
    ]) {
      expect(adrDocs).toContain(issueId);
    }
  });
});
