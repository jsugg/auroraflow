import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('documentation surface contract', () => {
  it('ships API-grade onboarding and reference docs', () => {
    const requiredDocs = [
      'docs/getting-started.md',
      'docs/writing-tests.md',
      'docs/configuration.md',
      'docs/api.md',
      'docs/architecture/self-healing.md',
      'docs/operations/observability-contract.md',
      'docs/operations/flakiness-analytics.md',
      'docs/operations/slo-dashboard-alerting.md',
    ];

    for (const docPath of requiredDocs) {
      expect(readRepoFile(docPath).trim().length).toBeGreaterThan(200);
    }
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
});
