import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectInvariant, expectTextIncludes } from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const DEPENDABOT_PATH = path.join(process.cwd(), '.github/dependabot.yml');
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  readonly scripts?: Record<string, string>;
};
const qualityWorkflow = readWorkflowModel('.github/workflows/quality.yml');

interface DependabotGroup {
  readonly name: string;
  readonly appliesTo?: string;
  readonly patterns: readonly string[];
}

interface DependabotUpdate {
  readonly packageEcosystem: string;
  readonly directory?: string;
  readonly scheduleInterval?: string;
  readonly ignoredMajorDependencies: readonly string[];
  readonly groups: ReadonlyMap<string, DependabotGroup>;
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
      groups: parseDependabotGroups(block),
    });
  }

  return updates;
}

function parseDependabotGroups(updateBlock: string): Map<string, DependabotGroup> {
  const groups = new Map<string, DependabotGroup>();
  const groupsHeader = /^ {4}groups:\s*$/m.exec(updateBlock);
  if (groupsHeader?.index === undefined) {
    return groups;
  }

  const groupsBlock = updateBlock.slice(groupsHeader.index + groupsHeader[0].length);
  const groupHeaders = [...groupsBlock.matchAll(/^ {6}([A-Za-z0-9_-]+):\s*$/gm)];

  for (let index = 0; index < groupHeaders.length; index += 1) {
    const header = groupHeaders[index];
    const groupName = header[1];
    if (groupName === undefined) {
      continue;
    }

    const start = header.index ?? 0;
    const nextHeader = groupHeaders[index + 1];
    const end = nextHeader?.index ?? groupsBlock.length;
    const block = groupsBlock.slice(start, end);
    groups.set(groupName, {
      name: groupName,
      appliesTo: parseScalarMatch(block, /^ {8}applies-to:\s*(.+)$/m),
      patterns: parseListUnder(block, 8, 'patterns', 10),
    });
  }

  return groups;
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

function parseListUnder(
  source: string,
  headerIndent: number,
  key: string,
  childIndent: number,
): string[] {
  const header = new RegExp(`^ {${headerIndent}}${key}:\\s*$`, 'm').exec(source);
  if (header?.index === undefined) {
    return [];
  }

  const block = source.slice(header.index + header[0].length);
  const values: string[] = [];
  const itemPattern = new RegExp(`^ {${childIndent}}-\\s*(.+)$`, 'gm');
  for (const match of block.matchAll(itemPattern)) {
    if (match[1] !== undefined) {
      values.push(parseQuotedScalar(match[1]));
    }
  }
  return values;
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

  it('ignores semver-major updates that are incompatible with the current toolchain', () => {
    const config = readFileSync(DEPENDABOT_PATH, 'utf8');
    const npmUpdate = parseDependabotUpdates(config).get('npm');

    expect(
      npmUpdate?.ignoredMajorDependencies,
      'Dependabot must keep semver-major ESLint and TypeScript updates blocked until the type-aware lint toolchain (typescript-eslint peer range) supports them.',
    ).toEqual(expect.arrayContaining(['eslint', '@eslint/js', 'typescript']));
  });

  it('keeps broad version-update groups separate from security-update groups', () => {
    const config = readFileSync(DEPENDABOT_PATH, 'utf8');
    const updates = parseDependabotUpdates(config);
    const npmGroups = updates.get('npm')?.groups;
    const actionsGroups = updates.get('github-actions')?.groups;

    expect(npmGroups?.get('npm-production')?.appliesTo).toBe('version-updates');
    expect(npmGroups?.get('npm-development')?.appliesTo).toBe('version-updates');
    expect(npmGroups?.get('npm-security')?.appliesTo).toBe('security-updates');
    expect(actionsGroups?.get('github-actions')?.appliesTo).toBe('version-updates');
    expect(actionsGroups?.get('github-actions-security')?.appliesTo).toBe('security-updates');
    expect(npmGroups?.get('npm-security')?.patterns).toEqual(['*']);
    expect(actionsGroups?.get('github-actions-security')?.patterns).toEqual(['*']);
  });

  it('runs an early lockfile drift guard for dependency automation changes', () => {
    const preflightJob = getWorkflowJob(qualityWorkflow, 'preflight');
    const lockfileJob = getWorkflowJob(qualityWorkflow, 'lockfile-drift');
    const filters = getWorkflowStep(preflightJob, 'Detect smoke-relevant changes').with.get(
      'filters',
    );

    expect(packageJson.scripts?.['lockfile:check']).toBe('node scripts/check-lockfile-drift.mjs');
    expect(preflightJob.outputs.get('run_lockfile_check')).toBe(
      '${{ steps.paths-filter.outputs.lockfile_check }}',
    );
    expectTextIncludes(filters ?? '', {
      text: 'lockfile_check:',
      rationale: 'Quality preflight must detect dependency automation and manifest changes.',
    });
    expectTextIncludes(lockfileJob.if ?? '', {
      text: "startsWith(github.head_ref, 'dependabot/')",
      rationale: 'Dependabot PRs must receive the early lockfile drift diagnostic.',
    });
    expect(getWorkflowStep(lockfileJob, 'Check package lockfile drift').run).toBe(
      'npm run lockfile:check',
    );
  });
});
