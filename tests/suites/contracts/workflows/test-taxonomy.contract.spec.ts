import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

interface CommandTierRow {
  readonly costTier: string;
  readonly scope: string;
}

const packageJson = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
) as PackageJson;
const scripts = packageJson.scripts ?? {};

function splitScriptSequence(scriptName: string): readonly string[] {
  const script = scripts[scriptName];
  if (script === undefined) {
    throw new Error(`Missing npm script: ${scriptName}`);
  }
  return script.split(/\s+&&\s+/);
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function parseCommandTierRows(markdown: string): Map<string, CommandTierRow> {
  const lines = markdown.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim() === '| Command | Cost tier | Scope |');
  if (headerIndex === -1) {
    throw new Error('Command cost-tier table not found');
  }

  const rows = new Map<string, CommandTierRow>();
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith('|')) {
      break;
    }

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const [command, costTier, scope] = cells;
    if (command !== undefined && costTier !== undefined && scope !== undefined) {
      rows.set(command, { costTier, scope });
    }
  }

  return rows;
}

describe('test script taxonomy contract', () => {
  it('maps npm test to the unit-only fast path', () => {
    expect(scripts.test).toBe('npm run test:unit');
    expect(scripts['test:unit']).toBe('vitest run tests/suites/unit');
  });

  it('keeps contracts separate from Redis and OTLP integration suites', () => {
    expect(scripts['test:contracts']).toBe('vitest run tests/suites/contracts');
    expect(scripts['test:integration']).toBe('vitest run tests/suites/integration');
    expect(scripts['test:integration:all']).toBe(
      'npm run test:integration && npm run test:contracts',
    );
  });

  it('requires contracts, Redis/OTLP integration, and schema validation in verify', () => {
    expect(splitScriptSequence('verify')).toEqual([
      'npm run verify:tools',
      'npm run format:check',
      'npm run lint',
      'npm run typecheck',
      'npm run test:unit',
      'npm run test:contracts',
      'npm run test:integration',
      'npm run schemas:check',
      'npm run shellcheck',
      'npm run workflows:lint',
    ]);
  });

  it('keeps canonical Vitest paths loud instead of optional no-test passes', () => {
    const canonicalScriptNames = [
      'test',
      'test:unit',
      'test:contracts',
      'test:integration',
      'test:integration:all',
      'test:coverage:global',
      'verify',
    ] as const;
    const vitestConfig = readRepoFile('vitest.config.mts');

    for (const scriptName of canonicalScriptNames) {
      const script = scripts[scriptName];
      expect(script).toBeDefined();
      expect(script).not.toMatch(/passWithNoTests|tests\/suites\/framework/);
    }
    expect(vitestConfig).not.toMatch(/passWithNoTests|tests\/suites\/framework/);
  });

  it('fails loudly when a suite path is missing', () => {
    const missingSuitePath = 'tests/suites/__missing-suite-for-contract__';
    const result = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'),
        'run',
        missingSuitePath,
        '--config',
        'vitest.config.mts',
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 15_000,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/No test files found/);
  }, 20_000);

  it('documents command cost tiers from implemented scripts', () => {
    const rows = parseCommandTierRows(readRepoFile('docs/development.md'));

    expect(rows.get('`npm test` / `npm run test:unit`')).toEqual({
      costTier: 'Fast local',
      scope: 'Unit tests only; no browser, Docker, Redis, or OTLP dependency.',
    });
    expect(rows.get('`npm run test:contracts`')?.scope).toBe(
      'Package, workflow, infrastructure, and docs contracts.',
    );
    expect(rows.get('`npm run test:integration`')?.scope).toBe(
      'Redis/Testcontainers and OTLP export.',
    );
  });
});
