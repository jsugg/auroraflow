#!/usr/bin/env node
// High+ npm audit gate with an explicit, expiring list of accepted advisories. Plain
// `npm audit --audit-level=high` cannot except an advisory that has no patched release,
// which would otherwise block every pull request until upstream ships a fix.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCEPTED_PATH = 'configs/security/accepted-advisories.json';
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const GHSA_PATTERN = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Collect distinct advisories from an `npm audit --json` report.
 * @param {any} report
 * @returns {Map<string, { severity: string, packages: Set<string>, title: string }>}
 */
export function collectAdvisories(report) {
  if (report === null || typeof report !== 'object' || typeof report.vulnerabilities !== 'object') {
    throw new Error('not a complete npm audit --json report');
  }
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      // String entries only point at another package's advisory chain.
      if (typeof via !== 'object' || via === null) continue;
      const id = GHSA_PATTERN.exec(String(via.url ?? ''))?.[0];
      if (id === undefined) continue;
      const entry = advisories.get(id) ?? {
        severity: via.severity,
        packages: new Set(),
        title: via.title,
      };
      entry.packages.add(via.name);
      advisories.set(id, entry);
    }
  }
  return advisories;
}

/**
 * @param {Map<string, { severity: string, packages: Set<string>, title: string }>} advisories
 * @param {ReadonlyArray<{ advisory: string, package: string, reason: string, expires: string }>} accepted
 * @param {string} today YYYY-MM-DD
 * @returns {{ blocking: string[], notes: string[] }}
 */
export function evaluate(advisories, accepted, today) {
  const blocking = [];
  const notes = [];
  const acceptedById = new Map(accepted.map((entry) => [entry.advisory, entry]));

  for (const entry of accepted) {
    if (
      !DATE_PATTERN.test(entry.expires) ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim() === ''
    ) {
      blocking.push(`accepted ${entry.advisory} needs a reason and an expires date (YYYY-MM-DD)`);
    } else if (entry.expires < today) {
      blocking.push(
        `accepted ${entry.advisory} expired on ${entry.expires}; re-review or remove it`,
      );
    }
    if (!advisories.has(entry.advisory)) {
      blocking.push(`accepted ${entry.advisory} is no longer reported; remove it`);
    }
  }

  for (const [id, advisory] of advisories) {
    const packages = [...advisory.packages].join(', ');
    if (acceptedById.has(id)) {
      notes.push(
        `ACCEPTED ${advisory.severity} ${id} (${packages}) until ${acceptedById.get(id)?.expires}`,
      );
    } else if (BLOCKING_SEVERITIES.has(advisory.severity)) {
      blocking.push(`unaccepted ${advisory.severity} ${id} (${packages}): ${advisory.title}`);
    } else {
      notes.push(`reported ${advisory.severity} ${id} (${packages})`);
    }
  }
  return { blocking, notes };
}

function main() {
  // `npm run` exports npm_config_allow_scripts, which npm 11 rejects in a nested project command.
  const env = { ...process.env };
  delete env.npm_config_allow_scripts;
  const audit = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error(
      `::error::npm audit did not return JSON (exit ${audit.status}).\n${audit.stderr}`,
    );
    return 2;
  }
  if (report?.error !== undefined) {
    console.error(`::error::npm audit failed: ${report.error.code} ${report.error.summary}`);
    return 2;
  }
  const accepted = JSON.parse(readFileSync(ACCEPTED_PATH, 'utf8')).accepted;
  const { blocking, notes } = evaluate(
    collectAdvisories(report),
    accepted,
    new Date().toISOString().slice(0, 10),
  );

  notes.forEach((line) => console.log(line));
  blocking.forEach((line) => console.error(`::error::${line}`));
  if (blocking.length > 0) return 1;
  console.log(
    `npm audit gate passed (${accepted.length} accepted advisories in ${ACCEPTED_PATH}).`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
