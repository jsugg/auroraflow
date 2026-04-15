import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFlakinessMarkdown,
  buildFlakinessSummary,
  extractFlakinessCasesFromReport,
  parseFlakinessReportFile,
} from '../../../../../src/framework/observability/flakinessReport';

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
  temporaryDirectories.clear();
});

function samplePlaywrightReport(): unknown {
  return {
    suites: [
      {
        title: '',
        suites: [
          {
            title: 'auth',
            specs: [
              {
                title: 'login succeeds',
                file: 'tests/suites/e2e/auth/login.spec.ts',
                line: 10,
                column: 3,
                tests: [
                  {
                    projectName: 'Google Chrome',
                    results: [{ status: 'failed' }, { status: 'passed' }],
                  },
                  {
                    projectName: 'Firefox',
                    results: [{ status: 'failed' }, { status: 'failed' }],
                  },
                ],
              },
              {
                title: 'logout succeeds',
                file: 'tests/suites/e2e/auth/logout.spec.ts',
                line: 20,
                column: 5,
                tests: [
                  {
                    projectName: 'Google Chrome',
                    results: [{ status: 'passed' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('extractFlakinessCasesFromReport', () => {
  it('extracts deterministic case metadata across projects and retries', () => {
    const cases = extractFlakinessCasesFromReport(samplePlaywrightReport());

    expect(cases).toHaveLength(3);

    const flakyCase = cases.find((testCase) => testCase.projectName === 'Google Chrome')!;
    expect(flakyCase.fullTitle).toBe('auth > login succeeds');
    expect(flakyCase.attempts).toBe(2);
    expect(flakyCase.retriesUsed).toBe(1);
    expect(flakyCase.failedAttempts).toBe(1);
    expect(flakyCase.finalStatus).toBe('passed');
    expect(flakyCase.flaky).toBe(true);

    const failedCase = cases.find((testCase) => testCase.projectName === 'Firefox')!;
    expect(failedCase.finalStatus).toBe('failed');
    expect(failedCase.flaky).toBe(false);
    expect(failedCase.failedAttempts).toBe(2);
  });

  it('returns an empty array for malformed report payloads', () => {
    expect(extractFlakinessCasesFromReport(null)).toEqual([]);
    expect(extractFlakinessCasesFromReport({ suites: 'not-an-array' })).toEqual([]);
  });
});

describe('buildFlakinessSummary', () => {
  it('aggregates flaky/failure totals and project breakdown', () => {
    const cases = extractFlakinessCasesFromReport(samplePlaywrightReport());
    const summary = buildFlakinessSummary({
      sourceFiles: 2,
      cases,
      generatedAt: new Date('2026-04-15T10:00:00.000Z'),
      topLimit: 1,
    });

    expect(summary.status).toBe('complete');
    expect(summary.sourceFiles).toBe(2);
    expect(summary.totalTests).toBe(3);
    expect(summary.flakyTests).toBe(1);
    expect(summary.failedTests).toBe(1);
    expect(summary.passedTests).toBe(2);
    expect(summary.totalAttempts).toBe(5);
    expect(summary.totalFailedAttempts).toBe(3);
    expect(summary.projectBreakdown).toEqual([
      {
        projectName: 'Firefox',
        totalTests: 1,
        flakyTests: 0,
        failedTests: 1,
        totalAttempts: 2,
        failedAttempts: 2,
      },
      {
        projectName: 'Google Chrome',
        totalTests: 2,
        flakyTests: 1,
        failedTests: 0,
        totalAttempts: 3,
        failedAttempts: 1,
      },
    ]);
    expect(summary.topFlakyCases).toHaveLength(1);
    expect(summary.topFlakyCases[0]?.projectName).toBe('Google Chrome');
    expect(summary.generatedAt).toBe('2026-04-15T10:00:00.000Z');
  });

  it('reports no-input status when no source files are provided', () => {
    const summary = buildFlakinessSummary({
      sourceFiles: 0,
      cases: [],
      generatedAt: new Date('2026-04-15T10:00:00.000Z'),
    });

    expect(summary.status).toBe('no-input');
    expect(summary.totalTests).toBe(0);
    expect(summary.projectBreakdown).toEqual([]);
  });
});

describe('report rendering and file parsing', () => {
  it('renders markdown with fallback rows when no flaky tests exist', () => {
    const summary = buildFlakinessSummary({
      sourceFiles: 1,
      cases: [],
      generatedAt: new Date('2026-04-15T10:00:00.000Z'),
    });
    const markdown = buildFlakinessMarkdown(summary);

    expect(markdown).toContain('# Flakiness Summary');
    expect(markdown).toContain('| _none_ | _none_ | 0 | 0 | _none_ |');
    expect(markdown).toContain('- Status: complete');
  });

  it('parses Playwright report files from disk', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'flakiness-report-'));
    temporaryDirectories.add(temporaryDirectory);
    const reportFile = path.join(temporaryDirectory, 'playwright-results-smoke.json');
    await writeFile(reportFile, `${JSON.stringify(samplePlaywrightReport())}\n`, 'utf8');

    const cases = await parseFlakinessReportFile(reportFile);
    expect(cases).toHaveLength(3);

    const serializedSummary = JSON.stringify(
      buildFlakinessSummary({
        sourceFiles: 1,
        cases,
      }),
      null,
      2,
    );
    await writeFile(path.join(temporaryDirectory, 'summary.json'), serializedSummary, 'utf8');

    const persisted = await readFile(path.join(temporaryDirectory, 'summary.json'), 'utf8');
    expect(persisted).toContain('"flakyTests": 1');
  });
});
