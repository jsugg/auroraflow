import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectInvariant } from '../../../helpers/contractAssertions';

const DEPENDABOT_PATH = path.join(process.cwd(), '.github/dependabot.yml');

interface DependabotUpdate {
  readonly packageEcosystem: string;
  readonly directory?: string;
  readonly scheduleInterval?: string;
  readonly ignoredMajorDependencies: readonly string[];
}

function parseDependabotUpdates(content: string): Map<string, DependabotUpdate> {
  const updateHeaders = [...content.matchAll(/^ {2}- package-ecosystem:\s*(.+)$/gm)];
  const updates = new Map<string, DependabotUpdate>();

  for (let index = 0; index < updateHeaders.length; index += 1) {
    const header = updateHeaders[index];
    const packageEcosystem = parseQuotedScalar(header[1] ?? '');
    if (packageEcosystem.length === 0) {
      continue;
    }

    const start = header.index ?? 0;
    const nextHeader = updateHeaders[index + 1];
    const end = nextHeader?.index ?? content.length;
    const block = content.slice(start, end);
    updates.set(packageEcosystem, {
      packageEcosystem,
      directory: parseScalarMatch(block, /^ {4}directory:\s*(.+)$/m),
      scheduleInterval: parseScalarMatch(block, /^ {6}interval:\s*(.+)$/m),
      ignoredMajorDependencies: parseSemverMajorIgnores(block),
    });
  }

  return updates;
}

function parseSemverMajorIgnores(updateBlock: string): string[] {
  const ignoreHeaders = [...updateBlock.matchAll(/^ {6}- dependency-name:\s*(.+)$/gm)];
  const dependencies: string[] = [];

  for (let index = 0; index < ignoreHeaders.length; index += 1) {
    const header = ignoreHeaders[index];
    const dependencyName = parseQuotedScalar(header[1] ?? '');
    const start = header.index ?? 0;
    const nextHeader = ignoreHeaders[index + 1];
    const end = nextHeader?.index ?? updateBlock.length;
    const block = updateBlock.slice(start, end);
    if (/version-update:semver-major/.test(block)) {
      dependencies.push(dependencyName);
    }
  }

  return dependencies;
}

function parseScalarMatch(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return parseQuotedScalar(match[1]);
}

function parseQuotedScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

describe('dependabot configuration contract', () => {
  it('defines repository-level dependabot automation config', () => {
    expectInvariant(
      existsSync(DEPENDABOT_PATH),
      'Repository must ship .github/dependabot.yml automation config.',
    );
  });

  it('covers npm and github-actions ecosystems on a weekly schedule', () => {
    const config = readFileSync(DEPENDABOT_PATH, 'utf8');
    const updates = parseDependabotUpdates(config);

    expect(
      parseScalarMatch(config, /^version:\s*(.+)$/m),
      'Dependabot schema version must be v2.',
    ).toBe('2');
    expect(
      updates.get('npm')?.directory,
      'Dependabot must cover npm updates at repository root.',
    ).toBe('/');
    expect(
      updates.get('github-actions')?.directory,
      'Dependabot must cover GitHub Actions updates at repository root.',
    ).toBe('/');
    expect(updates.get('npm')?.scheduleInterval, 'npm Dependabot cadence must stay weekly.').toBe(
      'weekly',
    );
    expect(
      updates.get('github-actions')?.scheduleInterval,
      'GitHub Actions Dependabot cadence must stay weekly.',
    ).toBe('weekly');
  });

  it('ignores semver-major eslint lane updates that are incompatible with the current toolchain', () => {
    const config = readFileSync(DEPENDABOT_PATH, 'utf8');
    const npmUpdate = parseDependabotUpdates(config).get('npm');

    expect(
      npmUpdate?.ignoredMajorDependencies,
      'Dependabot must keep semver-major ESLint lane updates blocked until toolchain support lands.',
    ).toEqual(expect.arrayContaining(['eslint', '@eslint/js']));
  });
});
