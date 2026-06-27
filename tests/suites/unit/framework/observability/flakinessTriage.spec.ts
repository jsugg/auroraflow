import { describe, expect, it } from 'vitest';
import {
  buildFlakinessSummary,
  buildFlakinessTriage,
  buildFlakinessTriageMarkdown,
  DEFAULT_FLAKINESS_TRIAGE_POLICY,
  parseFlakinessTriagePolicy,
  resolveFlakinessOwner,
  type FlakinessTestCase,
  type FlakinessTriagePolicy,
} from '../../../../../src/framework/observability/flakinessReport';

function makeCase(overrides: Partial<FlakinessTestCase> & { caseId: string }): FlakinessTestCase {
  return {
    caseId: overrides.caseId,
    projectName: overrides.projectName ?? 'Google Chrome',
    file: overrides.file ?? 'tests/suites/e2e/example.spec.ts',
    line: overrides.line ?? 1,
    column: overrides.column ?? 1,
    titlePath: overrides.titlePath ?? ['suite', overrides.caseId],
    fullTitle: overrides.fullTitle ?? `suite > ${overrides.caseId}`,
    attempts: overrides.attempts ?? 1,
    retriesUsed: overrides.retriesUsed ?? 0,
    failedAttempts: overrides.failedAttempts ?? 0,
    durationMs: overrides.durationMs ?? 10,
    finalStatus: overrides.finalStatus ?? 'passed',
    flaky: overrides.flaky ?? false,
  };
}

const POLICY: FlakinessTriagePolicy = {
  defaultOwner: 'team-default',
  owners: [
    { pathPrefix: 'tests/suites/e2e/', owner: 'team-e2e' },
    { pathPrefix: 'tests/suites/e2e/checkout/', owner: 'team-checkout' },
  ],
  quarantined: ['suite > quarantined'],
  repeatedFailureThreshold: 2,
};

function summaryFor(cases: FlakinessTestCase[]) {
  return buildFlakinessSummary({
    sourceFiles: 1,
    cases,
    generatedAt: new Date('2026-06-24T00:00:00.000Z'),
  });
}

describe('resolveFlakinessOwner', () => {
  it('credits the longest matching path prefix and falls back to the default owner', () => {
    expect(resolveFlakinessOwner('tests/suites/e2e/checkout/pay.spec.ts', POLICY)).toBe(
      'team-checkout',
    );
    expect(resolveFlakinessOwner('tests/suites/e2e/auth/login.spec.ts', POLICY)).toBe('team-e2e');
    expect(resolveFlakinessOwner('tests/suites/unit/utils.spec.ts', POLICY)).toBe('team-default');
  });
});

describe('buildFlakinessTriage (warn-first governance)', () => {
  it('triages flaky, failing, and quarantined cases, skipping clean passes', () => {
    const triage = buildFlakinessTriage({
      summary: summaryFor([
        makeCase({ caseId: 'clean', finalStatus: 'passed', flaky: false }),
        makeCase({ caseId: 'flaky', flaky: true, failedAttempts: 1, attempts: 2 }),
        makeCase({
          caseId: 'repeated',
          flaky: true,
          failedAttempts: 3,
          attempts: 4,
          file: 'tests/suites/e2e/checkout/pay.spec.ts',
        }),
        makeCase({ caseId: 'failing', finalStatus: 'failed', failedAttempts: 2 }),
        makeCase({
          caseId: 'quarantined',
          fullTitle: 'suite > quarantined',
          finalStatus: 'passed',
          flaky: false,
        }),
      ]),
      policy: POLICY,
    });

    expect(triage.policy).toBe('warn');
    // Clean pass is excluded; the other four are triaged.
    expect(triage.entries.map((entry) => entry.caseId).sort()).toEqual([
      'failing',
      'flaky',
      'quarantined',
      'repeated',
    ]);
    expect(triage.failingTests).toBe(1);
    expect(triage.flakyTests).toBe(3);
    expect(triage.quarantinedTests).toBe(1);
    expect(triage.repeatedFlakes).toBe(1);

    const repeated = triage.entries.find((entry) => entry.caseId === 'repeated')!;
    expect(repeated.owner).toBe('team-checkout');
    expect(repeated.repeated).toBe(true);
    expect(repeated.action).toContain('Repeated flake');

    const quarantined = triage.entries.find((entry) => entry.caseId === 'quarantined')!;
    expect(quarantined.quarantined).toBe(true);
    expect(quarantined.action).toContain('Quarantined');
  });

  it('orders failing first, then repeated flakes, then plain flakes', () => {
    const triage = buildFlakinessTriage({
      summary: summaryFor([
        makeCase({ caseId: 'plain-flaky', flaky: true, failedAttempts: 1, attempts: 2 }),
        makeCase({ caseId: 'repeated-flaky', flaky: true, failedAttempts: 2, attempts: 3 }),
        makeCase({ caseId: 'hard-failure', finalStatus: 'timedOut', failedAttempts: 1 }),
      ]),
      policy: POLICY,
    });

    expect(triage.entries.map((entry) => entry.caseId)).toEqual([
      'hard-failure',
      'repeated-flaky',
      'plain-flaky',
    ]);
  });

  it('aggregates per-owner totals', () => {
    const triage = buildFlakinessTriage({
      summary: summaryFor([
        makeCase({ caseId: 'a', flaky: true, failedAttempts: 1, attempts: 2 }),
        makeCase({ caseId: 'b', finalStatus: 'failed', failedAttempts: 1 }),
      ]),
      policy: POLICY,
    });

    expect(triage.owners).toEqual([{ owner: 'team-e2e', flaky: 1, failing: 1, quarantined: 0 }]);
  });

  it('defaults to the no-owner warn-first policy', () => {
    const triage = buildFlakinessTriage({
      summary: summaryFor([makeCase({ caseId: 'a', flaky: true, failedAttempts: 1, attempts: 2 })]),
    });

    expect(triage.entries[0]?.owner).toBe(DEFAULT_FLAKINESS_TRIAGE_POLICY.defaultOwner);
    expect(triage.policy).toBe('warn');
  });
});

describe('buildFlakinessTriageMarkdown', () => {
  it('renders owners and an actionable triage queue', () => {
    const markdown = buildFlakinessTriageMarkdown(
      buildFlakinessTriage({
        summary: summaryFor([
          makeCase({ caseId: 'failing', finalStatus: 'failed', failedAttempts: 1 }),
        ]),
        policy: POLICY,
      }),
    );

    expect(markdown).toContain('# Flakiness Triage');
    expect(markdown).toContain('- Policy: warn-first (does not block the merge gate)');
    expect(markdown).toContain('| team-e2e | 0 | 1 | 0 |');
    expect(markdown).toContain('| failing | team-e2e |');
    expect(markdown).toContain('Investigate failure');
  });

  it('renders fallback rows when nothing is triaged', () => {
    const markdown = buildFlakinessTriageMarkdown(
      buildFlakinessTriage({ summary: summaryFor([makeCase({ caseId: 'clean' })]) }),
    );

    expect(markdown).toContain('| _none_ | 0 | 0 | 0 |');
    expect(markdown).toContain(
      '| _none_ | _none_ | _none_ | _none_ | 0 | no | no | _none_ | _none_ |',
    );
  });
});

describe('parseFlakinessTriagePolicy', () => {
  it('parses a valid policy and drops malformed owner rules', () => {
    const policy = parseFlakinessTriagePolicy({
      defaultOwner: '@maintainer',
      owners: [
        { pathPrefix: 'tests/suites/e2e/', owner: '@e2e' },
        { pathPrefix: '', owner: '@bad' },
        { owner: '@missing-prefix' },
        'not-an-object',
      ],
      quarantined: ['suite > known-flake', 42],
      repeatedFailureThreshold: 5.9,
    });

    expect(policy.defaultOwner).toBe('@maintainer');
    expect(policy.owners).toEqual([{ pathPrefix: 'tests/suites/e2e/', owner: '@e2e' }]);
    expect(policy.quarantined).toEqual(['suite > known-flake']);
    expect(policy.repeatedFailureThreshold).toBe(5);
  });

  it('falls back to defaults for missing or invalid fields', () => {
    const policy = parseFlakinessTriagePolicy({ defaultOwner: '   ', repeatedFailureThreshold: 0 });

    expect(policy.defaultOwner).toBe(DEFAULT_FLAKINESS_TRIAGE_POLICY.defaultOwner);
    expect(policy.owners).toEqual([]);
    expect(policy.quarantined).toEqual([]);
    expect(policy.repeatedFailureThreshold).toBe(
      DEFAULT_FLAKINESS_TRIAGE_POLICY.repeatedFailureThreshold,
    );
  });

  it('rejects non-object policy payloads', () => {
    expect(() => parseFlakinessTriagePolicy(null)).toThrow(/must be a JSON object/);
    expect(() => parseFlakinessTriagePolicy('nope')).toThrow(/must be a JSON object/);
    expect(() => parseFlakinessTriagePolicy([])).toThrow(/must be a JSON object/);
  });
});
