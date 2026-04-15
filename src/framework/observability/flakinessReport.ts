import { readFile } from 'node:fs/promises';

export const PLAYWRIGHT_REPORT_FILE_PREFIX = 'playwright-results-';

export type FinalTestStatus =
  | 'passed'
  | 'failed'
  | 'timedOut'
  | 'skipped'
  | 'interrupted'
  | 'unknown';

export interface FlakinessTestCase {
  caseId: string;
  projectName: string;
  file: string;
  line: number;
  column: number;
  titlePath: string[];
  fullTitle: string;
  attempts: number;
  retriesUsed: number;
  failedAttempts: number;
  finalStatus: FinalTestStatus;
  flaky: boolean;
}

export interface ProjectFlakinessSummary {
  projectName: string;
  totalTests: number;
  flakyTests: number;
  failedTests: number;
  totalAttempts: number;
  failedAttempts: number;
}

export interface FlakinessSummary {
  generatedAt: string;
  status: 'complete' | 'no-input';
  sourceFiles: number;
  totalTests: number;
  flakyTests: number;
  failedTests: number;
  passedTests: number;
  skippedTests: number;
  interruptedTests: number;
  totalAttempts: number;
  totalFailedAttempts: number;
  projectBreakdown: ProjectFlakinessSummary[];
  topFlakyCases: FlakinessTestCase[];
  testCases: FlakinessTestCase[];
}

type UnknownRecord = Record<string, unknown>;

interface FlattenedSpec {
  file: string;
  line: number;
  column: number;
  titlePath: string[];
  tests: unknown[];
}

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value;
}

function asInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

function normalizeTitlePath(pathSegments: string[]): string[] {
  return pathSegments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function normalizeResultStatus(rawStatus: unknown): FinalTestStatus {
  const normalized = asString(rawStatus).trim();
  if (
    normalized === 'passed' ||
    normalized === 'failed' ||
    normalized === 'timedOut' ||
    normalized === 'skipped' ||
    normalized === 'interrupted'
  ) {
    return normalized;
  }
  return 'unknown';
}

function shouldCountAsFailed(status: FinalTestStatus): boolean {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

function flattenSuites(suites: unknown[], parentPath: string[]): FlattenedSpec[] {
  const flattened: FlattenedSpec[] = [];

  for (const rawSuite of suites) {
    const suite = asRecord(rawSuite);
    if (!suite) {
      continue;
    }

    const suiteTitle = asString(suite.title).trim();
    const currentPath = suiteTitle.length > 0 ? [...parentPath, suiteTitle] : [...parentPath];

    const specs = asArray(suite.specs);
    for (const rawSpec of specs) {
      const spec = asRecord(rawSpec);
      if (!spec) {
        continue;
      }

      const specTitle = asString(spec.title).trim();
      const titlePath = normalizeTitlePath(
        specTitle.length > 0 ? [...currentPath, specTitle] : [...currentPath],
      );
      const filePath = asString(spec.file).trim();

      flattened.push({
        file: filePath || 'unknown-file',
        line: asInteger(spec.line),
        column: asInteger(spec.column),
        titlePath,
        tests: asArray(spec.tests),
      });
    }

    const nestedSuites = asArray(suite.suites);
    if (nestedSuites.length > 0) {
      flattened.push(...flattenSuites(nestedSuites, currentPath));
    }
  }

  return flattened;
}

function sortTestCases(left: FlakinessTestCase, right: FlakinessTestCase): number {
  if (left.projectName !== right.projectName) {
    return left.projectName.localeCompare(right.projectName);
  }
  if (left.file !== right.file) {
    return left.file.localeCompare(right.file);
  }
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  if (left.column !== right.column) {
    return left.column - right.column;
  }
  if (left.fullTitle !== right.fullTitle) {
    return left.fullTitle.localeCompare(right.fullTitle);
  }
  return left.caseId.localeCompare(right.caseId);
}

function sortTopFlaky(left: FlakinessTestCase, right: FlakinessTestCase): number {
  if (right.failedAttempts !== left.failedAttempts) {
    return right.failedAttempts - left.failedAttempts;
  }
  if (right.retriesUsed !== left.retriesUsed) {
    return right.retriesUsed - left.retriesUsed;
  }
  return sortTestCases(left, right);
}

export function extractFlakinessCasesFromReport(report: unknown): FlakinessTestCase[] {
  const root = asRecord(report);
  if (!root) {
    return [];
  }

  const flattenedSpecs = flattenSuites(asArray(root.suites), []);
  const cases: FlakinessTestCase[] = [];

  for (const spec of flattenedSpecs) {
    spec.tests.forEach((rawTest, testIndex) => {
      const test = asRecord(rawTest);
      if (!test) {
        return;
      }

      const projectName = asString(test.projectName).trim() || 'unknown-project';
      const results = asArray(test.results).map(normalizeResultRecord);
      const attempts = results.length;
      const retriesUsed = attempts > 0 ? attempts - 1 : 0;
      const failedAttempts = results.reduce(
        (count, result) => (shouldCountAsFailed(result.status) ? count + 1 : count),
        0,
      );
      const finalStatus = attempts > 0 ? results[attempts - 1].status : 'unknown';
      const flaky = failedAttempts > 0 && finalStatus === 'passed';
      const fullTitle = spec.titlePath.join(' > ');
      const caseId = [
        projectName,
        spec.file,
        `${spec.line}:${spec.column}`,
        fullTitle || 'unnamed-test',
        `case-${testIndex}`,
      ].join('::');

      cases.push({
        caseId,
        projectName,
        file: spec.file,
        line: spec.line,
        column: spec.column,
        titlePath: spec.titlePath,
        fullTitle: fullTitle || 'unnamed-test',
        attempts,
        retriesUsed,
        failedAttempts,
        finalStatus,
        flaky,
      });
    });
  }

  return cases.sort(sortTestCases);
}

function normalizeResultRecord(result: unknown): { status: FinalTestStatus } {
  const normalized = asRecord(result);
  if (!normalized) {
    return { status: 'unknown' };
  }
  return {
    status: normalizeResultStatus(normalized.status),
  };
}

function mapProjectBreakdown(cases: FlakinessTestCase[]): ProjectFlakinessSummary[] {
  const byProject = new Map<string, ProjectFlakinessSummary>();

  for (const testCase of cases) {
    const existing =
      byProject.get(testCase.projectName) ??
      ({
        projectName: testCase.projectName,
        totalTests: 0,
        flakyTests: 0,
        failedTests: 0,
        totalAttempts: 0,
        failedAttempts: 0,
      } satisfies ProjectFlakinessSummary);

    existing.totalTests += 1;
    existing.totalAttempts += testCase.attempts;
    existing.failedAttempts += testCase.failedAttempts;
    if (testCase.flaky) {
      existing.flakyTests += 1;
    }
    if (shouldCountAsFailed(testCase.finalStatus)) {
      existing.failedTests += 1;
    }
    byProject.set(testCase.projectName, existing);
  }

  return [...byProject.values()].sort((left, right) =>
    left.projectName.localeCompare(right.projectName),
  );
}

export function buildFlakinessSummary({
  sourceFiles,
  cases,
  generatedAt = new Date(),
  topLimit = 10,
}: {
  sourceFiles: number;
  cases: FlakinessTestCase[];
  generatedAt?: Date;
  topLimit?: number;
}): FlakinessSummary {
  const boundedTopLimit = Number.isFinite(topLimit) ? Math.max(1, Math.floor(topLimit)) : 10;
  const sortedCases = [...cases].sort(sortTestCases);

  const flakyCases = sortedCases.filter((testCase) => testCase.flaky);
  const failedCases = sortedCases.filter((testCase) => shouldCountAsFailed(testCase.finalStatus));
  const passedCases = sortedCases.filter((testCase) => testCase.finalStatus === 'passed');
  const skippedCases = sortedCases.filter((testCase) => testCase.finalStatus === 'skipped');
  const interruptedCases = sortedCases.filter((testCase) => testCase.finalStatus === 'interrupted');

  return {
    generatedAt: generatedAt.toISOString(),
    status: sourceFiles === 0 ? 'no-input' : 'complete',
    sourceFiles,
    totalTests: sortedCases.length,
    flakyTests: flakyCases.length,
    failedTests: failedCases.length,
    passedTests: passedCases.length,
    skippedTests: skippedCases.length,
    interruptedTests: interruptedCases.length,
    totalAttempts: sortedCases.reduce((count, testCase) => count + testCase.attempts, 0),
    totalFailedAttempts: sortedCases.reduce(
      (count, testCase) => count + testCase.failedAttempts,
      0,
    ),
    projectBreakdown: mapProjectBreakdown(sortedCases),
    topFlakyCases: [...flakyCases].sort(sortTopFlaky).slice(0, boundedTopLimit),
    testCases: sortedCases,
  };
}

function toProjectTableRows(projectBreakdown: ProjectFlakinessSummary[]): string {
  if (projectBreakdown.length === 0) {
    return '| _none_ | 0 | 0 | 0 | 0 | 0 |\n';
  }

  return projectBreakdown
    .map(
      (entry) =>
        `| ${entry.projectName} | ${entry.totalTests} | ${entry.flakyTests} | ${entry.failedTests} | ${entry.totalAttempts} | ${entry.failedAttempts} |`,
    )
    .join('\n');
}

function toTopFlakyRows(topFlakyCases: FlakinessTestCase[]): string {
  if (topFlakyCases.length === 0) {
    return '| _none_ | _none_ | 0 | 0 | _none_ |\n';
  }

  return topFlakyCases
    .map(
      (testCase) =>
        `| ${testCase.projectName} | ${testCase.fullTitle} | ${testCase.failedAttempts} | ${testCase.attempts} | ${testCase.file}:${testCase.line} |`,
    )
    .join('\n');
}

export function buildFlakinessMarkdown(summary: FlakinessSummary): string {
  return [
    '# Flakiness Summary',
    '',
    `- Generated at: ${summary.generatedAt}`,
    `- Status: ${summary.status}`,
    `- Source files analyzed: ${summary.sourceFiles}`,
    `- Total tests: ${summary.totalTests}`,
    `- Flaky tests: ${summary.flakyTests}`,
    `- Failed tests: ${summary.failedTests}`,
    `- Passed tests: ${summary.passedTests}`,
    `- Skipped tests: ${summary.skippedTests}`,
    `- Interrupted tests: ${summary.interruptedTests}`,
    `- Total attempts: ${summary.totalAttempts}`,
    `- Failed attempts: ${summary.totalFailedAttempts}`,
    '',
    '## Project Breakdown',
    '',
    '| Project | Tests | Flaky | Failed | Attempts | Failed Attempts |',
    '|---|---:|---:|---:|---:|---:|',
    toProjectTableRows(summary.projectBreakdown),
    '',
    '## Top Flaky Cases',
    '',
    '| Project | Test | Failed Attempts | Attempts | Location |',
    '|---|---|---:|---:|---|',
    toTopFlakyRows(summary.topFlakyCases),
    '',
  ].join('\n');
}

export async function parseFlakinessReportFile(reportFile: string): Promise<FlakinessTestCase[]> {
  const content = await readFile(reportFile, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  return extractFlakinessCasesFromReport(parsed);
}
