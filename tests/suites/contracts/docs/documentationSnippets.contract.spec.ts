import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SNIPPET_CHECK_SCRIPT = 'scripts/docs-snippets-check.mjs';
const SNIPPET_CHECK_TIMEOUT_MS = 180_000;

/** Opt-outs are allowed but must stay rare; raising this ceiling is a deliberate decision. */
const MAX_OPT_OUTS = 3;

interface SnippetFinding {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

interface SnippetOptOut {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

interface SnippetReport {
  readonly totalSnippets: number;
  readonly compiledSnippets: number;
  readonly optOuts: readonly SnippetOptOut[];
  readonly findings: readonly SnippetFinding[];
}

function runSnippetCheck(): SnippetReport {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, SNIPPET_CHECK_SCRIPT), '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: SNIPPET_CHECK_TIMEOUT_MS },
  );

  expect(result.error, `${SNIPPET_CHECK_SCRIPT} must run to completion`).toBeUndefined();
  return JSON.parse(result.stdout) as SnippetReport;
}

describe('documentation snippet contract', () => {
  it(
    'type-checks every documentation snippet against the package source',
    () => {
      const report = runSnippetCheck();

      expect(
        report.totalSnippets,
        'Snippet check must find TypeScript examples; zero means the fence extractor broke.',
      ).toBeGreaterThan(0);

      expect(
        report.findings.map(
          (finding) => `${finding.file}:${finding.line} ${finding.code}: ${finding.message}`,
        ),
        'Documentation snippets must compile against the package API. Run `npm run docs:snippets` for the full report.',
      ).toEqual([]);
    },
    SNIPPET_CHECK_TIMEOUT_MS,
  );

  it(
    'keeps snippet compile opt-outs rare and justified',
    () => {
      const report = runSnippetCheck();

      expect(
        report.optOuts.length,
        `At most ${MAX_OPT_OUTS} snippets may opt out of compiling. Prefer a "snippet: context" directive that supplies the missing setup over exempting an example.`,
      ).toBeLessThanOrEqual(MAX_OPT_OUTS);

      const unjustified = report.optOuts.filter((optOut) => optOut.reason.trim().length === 0);
      expect(
        unjustified,
        'Every snippet opt-out must state why the example cannot compile.',
      ).toEqual([]);
    },
    SNIPPET_CHECK_TIMEOUT_MS,
  );
});
