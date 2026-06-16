import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function parseCodeowners(content: string): ReadonlyMap<string, readonly string[]> {
  const entries = new Map<string, readonly string[]>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (pattern !== undefined && owners.length > 0) {
      entries.set(pattern, owners);
    }
  }

  return entries;
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
      'docs/operations/lifecycle.md',
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

  it('documents lifecycle and fixture contract without claiming Phase 2 implementation', () => {
    const lifecycle = readRepoFile('docs/operations/lifecycle.md');
    const api = readRepoFile('docs/api.md');
    const development = readRepoFile('docs/development.md');
    const docs = `${lifecycle}\n${api}\n${development}`;

    for (const requiredTerm of [
      'closeAuroraFlow(context?)',
      'auroraflow/playwright',
      'AUR-IMPL-023',
      'one-shot per runtime context',
      'concurrent calls for the same context coalesce',
      'reverse registration order',
      'aggregate error',
      'disabled subsystems are no-ops',
      'PageFactory(page)',
      'Playwright `Page`, `BrowserContext`, and `Browser` objects are never closed',
      'no process-exit hooks',
    ]) {
      expect(docs).toContain(requiredTerm);
    }

    expect(lifecycle).toContain('design contract for `AUR-IMPL-013`');
    expect(lifecycle).toContain('implementation remains a Phase 2 task');
    expect(development).toContain('labeled as planned until `AUR-IMPL-023`');
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
    expect(parseCodeowners(codeowners).get('*')).toContain('@jsugg');
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
