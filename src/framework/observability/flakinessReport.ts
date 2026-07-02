import { readFile } from 'node:fs/promises';

export const PLAYWRIGHT_REPORT_FILE_PREFIX = 'playwright-results-';

export type FinalTestStatus =
  'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted' | 'unknown';

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
  durationMs: number;
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

function asNonNegativeInteger(value: unknown): number {
  return Math.max(0, asInteger(value));
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
      const durationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
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
        durationMs,
        finalStatus,
        flaky,
      });
    });
  }

  return cases.sort(sortTestCases);
}

function normalizeResultRecord(result: unknown): { durationMs: number; status: FinalTestStatus } {
  const normalized = asRecord(result);
  if (!normalized) {
    return { durationMs: 0, status: 'unknown' };
  }
  return {
    durationMs: asNonNegativeInteger(normalized.duration),
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

// ---------------------------------------------------------------------------
// Flake triage governance
// ---------------------------------------------------------------------------

/** Path-prefix ownership rule used to credit a flaky/failing test to an owner. */
export interface FlakinessOwnerRule {
  /** Test-file path prefix this rule matches; the longest match wins. */
  readonly pathPrefix: string;
  /** Owner credited for matching cases. */
  readonly owner: string;
}

/**
 * Warn-first flake triage policy. The policy never blocks the merge gate; it maps
 * flaky/failing tests to owners and keeps quarantined and repeated flakes visible
 * in the report.
 */
export interface FlakinessTriagePolicy {
  /** Owner used when no path rule matches. */
  readonly defaultOwner: string;
  /** Path-prefix ownership rules. */
  readonly owners: readonly FlakinessOwnerRule[];
  /** Case identifiers (`caseId` or `fullTitle`) that are quarantined. */
  readonly quarantined: readonly string[];
  /** Minimum failed attempts for a flaky case to count as a repeated flake. */
  readonly repeatedFailureThreshold: number;
}

/** Default warn-first policy: no owners, nothing quarantined, repeat at 2 failed attempts. */
export const DEFAULT_FLAKINESS_TRIAGE_POLICY: FlakinessTriagePolicy = {
  defaultOwner: 'unassigned',
  owners: [],
  quarantined: [],
  repeatedFailureThreshold: 2,
};

export type FlakinessTriageStatus = 'flaky' | 'failing';

export interface FlakinessTriageEntry {
  readonly caseId: string;
  readonly projectName: string;
  readonly fullTitle: string;
  readonly file: string;
  readonly line: number;
  readonly owner: string;
  readonly status: FlakinessTriageStatus;
  readonly failedAttempts: number;
  readonly quarantined: boolean;
  readonly repeated: boolean;
  readonly action: string;
}

export interface FlakinessOwnerTriageSummary {
  readonly owner: string;
  readonly flaky: number;
  readonly failing: number;
  readonly quarantined: number;
}

export interface FlakinessTriageReport {
  readonly generatedAt: string;
  /** Warn-first: triage surfaces ownership and action but never blocks merges. */
  readonly policy: 'warn';
  readonly totalTriaged: number;
  readonly flakyTests: number;
  readonly failingTests: number;
  readonly quarantinedTests: number;
  readonly repeatedFlakes: number;
  readonly owners: readonly FlakinessOwnerTriageSummary[];
  readonly entries: readonly FlakinessTriageEntry[];
}

/** Resolves the owner for a test file using the longest matching path prefix. */
export function resolveFlakinessOwner(file: string, policy: FlakinessTriagePolicy): string {
  let owner = policy.defaultOwner;
  let matchedLength = -1;
  for (const rule of policy.owners) {
    if (file.startsWith(rule.pathPrefix) && rule.pathPrefix.length > matchedLength) {
      owner = rule.owner;
      matchedLength = rule.pathPrefix.length;
    }
  }
  return owner;
}

function isQuarantinedCase(testCase: FlakinessTestCase, policy: FlakinessTriagePolicy): boolean {
  return (
    policy.quarantined.includes(testCase.caseId) || policy.quarantined.includes(testCase.fullTitle)
  );
}

function triageActionFor({
  status,
  quarantined,
  repeated,
}: {
  status: FlakinessTriageStatus;
  quarantined: boolean;
  repeated: boolean;
}): string {
  if (quarantined) {
    return 'Quarantined: keep tracking; remove from quarantine once stable.';
  }
  if (status === 'failing') {
    return 'Investigate failure; assign an owner and fix or quarantine.';
  }
  if (repeated) {
    return 'Repeated flake: prioritize root-cause; consider quarantine.';
  }
  return 'Flaky: monitor and root-cause if it recurs.';
}

function triageRank(entry: FlakinessTriageEntry): number {
  if (entry.status === 'failing') {
    return 0;
  }
  return entry.repeated ? 1 : 2;
}

function compareTriageEntries(left: FlakinessTriageEntry, right: FlakinessTriageEntry): number {
  // Failing first, then repeated flakes, then plain flakes; ties by failed
  // attempts (desc) and then stable identity keys.
  if (triageRank(left) !== triageRank(right)) {
    return triageRank(left) - triageRank(right);
  }
  if (right.failedAttempts !== left.failedAttempts) {
    return right.failedAttempts - left.failedAttempts;
  }
  if (left.owner !== right.owner) {
    return left.owner.localeCompare(right.owner);
  }
  if (left.projectName !== right.projectName) {
    return left.projectName.localeCompare(right.projectName);
  }
  if (left.fullTitle !== right.fullTitle) {
    return left.fullTitle.localeCompare(right.fullTitle);
  }
  return left.caseId.localeCompare(right.caseId);
}

/**
 * Builds a warn-first triage report from a flakiness summary. Includes every
 * flaky, failing, or quarantined case, credits each to an owner, and flags
 * repeated flakes (failed attempts at or over the policy threshold) so they stay
 * visible even when the final attempt passed.
 */
export function buildFlakinessTriage({
  summary,
  policy = DEFAULT_FLAKINESS_TRIAGE_POLICY,
}: {
  summary: FlakinessSummary;
  policy?: FlakinessTriagePolicy;
}): FlakinessTriageReport {
  const repeatedThreshold = Number.isFinite(policy.repeatedFailureThreshold)
    ? Math.max(1, Math.floor(policy.repeatedFailureThreshold))
    : DEFAULT_FLAKINESS_TRIAGE_POLICY.repeatedFailureThreshold;

  const entries: FlakinessTriageEntry[] = [];
  const ownerTotals = new Map<string, FlakinessOwnerTriageSummary>();

  for (const testCase of summary.testCases) {
    const failing = shouldCountAsFailed(testCase.finalStatus);
    const quarantined = isQuarantinedCase(testCase, policy);
    if (!testCase.flaky && !failing && !quarantined) {
      continue;
    }

    const status: FlakinessTriageStatus = failing ? 'failing' : 'flaky';
    const repeated = testCase.flaky && testCase.failedAttempts >= repeatedThreshold;
    const owner = resolveFlakinessOwner(testCase.file, policy);

    entries.push({
      caseId: testCase.caseId,
      projectName: testCase.projectName,
      fullTitle: testCase.fullTitle,
      file: testCase.file,
      line: testCase.line,
      owner,
      status,
      failedAttempts: testCase.failedAttempts,
      quarantined,
      repeated,
      action: triageActionFor({ status, quarantined, repeated }),
    });

    const totals = ownerTotals.get(owner) ?? { owner, flaky: 0, failing: 0, quarantined: 0 };
    ownerTotals.set(owner, {
      owner,
      flaky: totals.flaky + (status === 'flaky' ? 1 : 0),
      failing: totals.failing + (status === 'failing' ? 1 : 0),
      quarantined: totals.quarantined + (quarantined ? 1 : 0),
    });
  }

  entries.sort(compareTriageEntries);
  const owners = [...ownerTotals.values()].sort((left, right) =>
    left.owner.localeCompare(right.owner),
  );

  return {
    generatedAt: summary.generatedAt,
    policy: 'warn',
    totalTriaged: entries.length,
    flakyTests: entries.filter((entry) => entry.status === 'flaky').length,
    failingTests: entries.filter((entry) => entry.status === 'failing').length,
    quarantinedTests: entries.filter((entry) => entry.quarantined).length,
    repeatedFlakes: entries.filter((entry) => entry.repeated).length,
    owners,
    entries,
  };
}

function toTriageOwnerRows(owners: readonly FlakinessOwnerTriageSummary[]): string {
  if (owners.length === 0) {
    return '| _none_ | 0 | 0 | 0 |';
  }
  return owners
    .map((entry) => `| ${entry.owner} | ${entry.flaky} | ${entry.failing} | ${entry.quarantined} |`)
    .join('\n');
}

function toTriageEntryRows(entries: readonly FlakinessTriageEntry[]): string {
  if (entries.length === 0) {
    return '| _none_ | _none_ | _none_ | _none_ | 0 | no | no | _none_ | _none_ |';
  }
  return entries
    .map(
      (entry) =>
        `| ${entry.status} | ${entry.owner} | ${entry.fullTitle} | ${entry.projectName} | ` +
        `${entry.failedAttempts} | ${entry.quarantined ? 'yes' : 'no'} | ` +
        `${entry.repeated ? 'yes' : 'no'} | ${entry.file}:${entry.line} | ${entry.action} |`,
    )
    .join('\n');
}

/** Renders the warn-first triage report as actionable Markdown. */
export function buildFlakinessTriageMarkdown(triage: FlakinessTriageReport): string {
  return [
    '# Flakiness Triage',
    '',
    `- Generated at: ${triage.generatedAt}`,
    '- Policy: warn-first (does not block the merge gate)',
    `- Flaky tests: ${triage.flakyTests}`,
    `- Failing tests: ${triage.failingTests}`,
    `- Quarantined: ${triage.quarantinedTests}`,
    `- Repeated flakes: ${triage.repeatedFlakes}`,
    '',
    '## Owners',
    '',
    '| Owner | Flaky | Failing | Quarantined |',
    '|---|---:|---:|---:|',
    toTriageOwnerRows(triage.owners),
    '',
    '## Triage Queue',
    '',
    '| Status | Owner | Test | Project | Failed Attempts | Quarantined | Repeated | Location | Action |',
    '|---|---|---|---|---:|:---:|:---:|---|---|',
    toTriageEntryRows(triage.entries),
    '',
  ].join('\n');
}

/** Parses and validates a triage policy from untrusted JSON (CLI `--triage-policy`). */
export function parseFlakinessTriagePolicy(raw: unknown): FlakinessTriagePolicy {
  const record = asRecord(raw);
  if (!record) {
    throw new Error('Flakiness triage policy must be a JSON object.');
  }

  const defaultOwner =
    typeof record.defaultOwner === 'string' && record.defaultOwner.trim().length > 0
      ? record.defaultOwner
      : DEFAULT_FLAKINESS_TRIAGE_POLICY.defaultOwner;

  const owners: FlakinessOwnerRule[] = [];
  for (const candidate of asArray(record.owners)) {
    const ruleRecord = asRecord(candidate);
    if (!ruleRecord) {
      continue;
    }
    const { pathPrefix, owner } = ruleRecord;
    if (
      typeof pathPrefix === 'string' &&
      pathPrefix.length > 0 &&
      typeof owner === 'string' &&
      owner.length > 0
    ) {
      owners.push({ pathPrefix, owner });
    }
  }

  const quarantined = asArray(record.quarantined).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  const repeatedFailureThreshold =
    typeof record.repeatedFailureThreshold === 'number' &&
    Number.isFinite(record.repeatedFailureThreshold) &&
    record.repeatedFailureThreshold >= 1
      ? Math.floor(record.repeatedFailureThreshold)
      : DEFAULT_FLAKINESS_TRIAGE_POLICY.repeatedFailureThreshold;

  return { defaultOwner, owners, quarantined, repeatedFailureThreshold };
}
