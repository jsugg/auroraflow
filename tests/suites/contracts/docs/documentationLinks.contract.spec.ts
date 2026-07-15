import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const LINK_CHECK_SCRIPT = 'scripts/docs-link-check.mjs';
const LINK_CHECK_TIMEOUT_MS = 30_000;
const VIOLATIONS_FIXTURE = 'tests/fixtures/docs/link-check-violations.md';

interface LinkFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

interface ExternalLink {
  readonly file: string;
  readonly line: number;
  readonly target: string;
}

interface LinkCheckReport {
  readonly checkedFiles: number;
  readonly findings: readonly LinkFinding[];
  readonly externalLinks: readonly ExternalLink[];
}

function runLinkCheck(documentPaths: readonly string[] = []): LinkCheckReport {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, LINK_CHECK_SCRIPT), '--json', ...documentPaths],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: LINK_CHECK_TIMEOUT_MS },
  );

  expect(result.error, `${LINK_CHECK_SCRIPT} must run to completion`).toBeUndefined();
  return JSON.parse(result.stdout) as LinkCheckReport;
}

describe('documentation link contract', () => {
  it('keeps every relative link, anchor, and accessibility rule valid across the docs', () => {
    const report = runLinkCheck();

    expect(
      report.checkedFiles,
      'Link check must cover the documentation set; zero files means the scope resolver broke.',
    ).toBeGreaterThan(0);

    expect(
      report.findings.map(
        (finding) => `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
      ),
      'Documentation must keep relative links, anchors, image alt text, heading progression, and link text valid. Run `npm run docs:links` for the full report.',
    ).toEqual([]);
  });

  it('reports external links without making them a blocking gate', () => {
    const report = runLinkCheck();

    expect(
      report.externalLinks.length,
      'External links must still be collected for review even though liveness is never checked.',
    ).toBeGreaterThan(0);

    const externalFindings = report.findings.filter((finding) => /^https?:/u.test(finding.message));
    expect(
      externalFindings,
      'External link liveness must never block: the contract suite is network-free by design.',
    ).toEqual([]);
  });

  it('detects every documentation defect class it claims to check', () => {
    const report = runLinkCheck([VIOLATIONS_FIXTURE]);
    const detectedRules = [...new Set(report.findings.map((finding) => finding.rule))].sort();

    expect(
      detectedRules,
      'The planted-defect fixture must trip every documentation rule, proving the check is not vacuous.',
    ).toEqual(['anchor', 'heading-skip', 'image-alt', 'link-text', 'missing-target']);
  });
});
