import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

interface Advisory {
  readonly severity: string;
  readonly packages: Set<string>;
  readonly title: string;
}

interface AcceptedEntry {
  readonly advisory: string;
  readonly package: string;
  readonly reason: string;
  readonly expires: string;
}

interface SecurityAuditModule {
  collectAdvisories(report: unknown): Map<string, Advisory>;
  evaluate(
    advisories: Map<string, Advisory>,
    accepted: readonly AcceptedEntry[],
    today: string,
  ): { blocking: string[]; notes: string[] };
}

const MODULE_URL = pathToFileURL(path.join(process.cwd(), 'scripts/security-audit.mjs')).href;

function report(entries: ReadonlyArray<{ id: string; name: string; severity: string }>): unknown {
  return {
    vulnerabilities: Object.fromEntries(
      entries.map((entry) => [
        entry.name,
        {
          name: entry.name,
          severity: entry.severity,
          via: [
            {
              url: `https://github.com/advisories/${entry.id}`,
              name: entry.name,
              severity: entry.severity,
              title: `${entry.name} issue`,
            },
            'some-parent',
          ],
        },
      ]),
    ),
  };
}

const ACCEPTED: AcceptedEntry = {
  advisory: 'GHSA-aaaa-bbbb-cccc',
  package: 'pkg',
  reason: 'no fix exists; dev-only',
  expires: '2027-01-31',
};

describe('security audit gate', () => {
  let gate: SecurityAuditModule;

  beforeAll(async () => {
    gate = (await import(MODULE_URL)) as SecurityAuditModule;
  });

  it('blocks an unaccepted high advisory and only reports a moderate one', () => {
    const advisories = gate.collectAdvisories(
      report([
        { id: 'GHSA-hhhh-hhhh-hhhh', name: 'high-pkg', severity: 'high' },
        { id: 'GHSA-mmmm-mmmm-mmmm', name: 'mod-pkg', severity: 'moderate' },
      ]),
    );

    const result = gate.evaluate(advisories, [], '2026-11-18');

    expect(result.blocking).toEqual([
      'unaccepted high GHSA-hhhh-hhhh-hhhh (high-pkg): high-pkg issue',
    ]);
    expect(result.notes).toEqual(['reported moderate GHSA-mmmm-mmmm-mmmm (mod-pkg)']);
  });

  it('passes an accepted advisory until it expires', () => {
    const advisories = gate.collectAdvisories(
      report([{ id: ACCEPTED.advisory, name: 'pkg', severity: 'high' }]),
    );

    expect(gate.evaluate(advisories, [ACCEPTED], '2027-01-31').blocking).toEqual([]);
    expect(gate.evaluate(advisories, [ACCEPTED], '2027-02-01').blocking).toEqual([
      `accepted ${ACCEPTED.advisory} expired on 2027-01-31; re-review or remove it`,
    ]);
  });

  it('fails on a stale or incomplete accepted entry', () => {
    const empty = gate.collectAdvisories(report([]));

    expect(gate.evaluate(empty, [ACCEPTED], '2026-11-18').blocking).toEqual([
      `accepted ${ACCEPTED.advisory} is no longer reported; remove it`,
    ]);
    expect(
      gate.evaluate(empty, [{ ...ACCEPTED, reason: ' ', expires: 'soon' }], '2026-11-18').blocking,
    ).toContain(`accepted ${ACCEPTED.advisory} needs a reason and an expires date (YYYY-MM-DD)`);
  });

  it('rejects a report without a vulnerabilities map', () => {
    expect(() => gate.collectAdvisories({ error: 'boom' })).toThrow(
      'not a complete npm audit --json report',
    );
  });
});
