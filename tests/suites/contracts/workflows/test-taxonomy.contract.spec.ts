import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectTextExcludes,
  expectTextIncludes,
  expectTextMatches,
  expectTextNotMatches,
} from '../../../helpers/contractAssertions';

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
const BRITTLE_ASSERTION_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] =
  [
    { label: 'raw text matcher', pattern: /\.(?:not\.)?(?:toContain|toMatch)\(/u },
    { label: 'bare boolean matcher', pattern: /\.toBe\((?:true|false)\)/u },
  ];

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

function listContractSpecPaths(
  rootPath = path.join(REPO_ROOT, 'tests/suites/contracts'),
): string[] {
  return readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return listContractSpecPaths(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function findBrittleAssertionOffenders(relativePath: string): readonly string[] {
  return readRepoFile(relativePath)
    .split('\n')
    .flatMap((line, index) => {
      const violation = BRITTLE_ASSERTION_PATTERNS.find(({ pattern }) => pattern.test(line));
      return violation === undefined ? [] : [`${relativePath}:${index + 1} (${violation.label})`];
    });
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
    expect(scripts['test:unit']).toBe('vitest run tests/suites/unit --pool=threads --no-isolate');
  });

  it('keeps contracts separate from Redis and OTLP integration suites', () => {
    expect(scripts['test:contracts']).toBe(
      'vitest run tests/suites/contracts --config=configs/vitest.contracts.mts',
    );
    expect(scripts['test:integration']).toBe('vitest run tests/suites/integration');
    expect(scripts['test:integration:all']).toBe(
      'npm run test:integration && npm run test:contracts',
    );
  });

  it('runs guarded self-healing proof with multiple workers to catch artifact races', () => {
    expect(scripts['test:e2e:guarded']).toBe(
      "npm run test:e2e -- --project='Google Chrome' --grep 'guarded self-heal' --workers=2",
    );
  });

  it('keeps self-healing artifact reads and cleanup scoped per test', () => {
    const selfHealingTestFiles = [
      'tests/suites/e2e/examples/self-healing-sat.spec.ts',
      'tests/suites/e2e/fixtures/guarded-self-healing.spec.ts',
      'tests/suites/unit/framework/pageObjectBase/pageObjectBaseSelfHealing.spec.ts',
    ] as const;

    for (const filePath of selfHealingTestFiles) {
      const content = readRepoFile(filePath);

      expectTextIncludes(content, {
        text: 'readSelfHealingArtifactFor',
        rationale: `${filePath} must read artifacts through per-test scoped helper.`,
      });
      expectTextExcludes(content, {
        text: "path.join(process.cwd(), 'test-results', 'self-healing')",
        rationale: `${filePath} must not read shared self-healing artifact root directly.`,
      });
      expectTextNotMatches(content, {
        pattern: /\brm\([^)]*(?:ARTIFACTS_DIR|artifactsDir)/u,
        rationale: `${filePath} must not delete shared artifact roots from tests.`,
      });
    }
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
      'npm run workflows:lint:check',
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
      expectTextNotMatches(script ?? '', {
        pattern: /passWithNoTests|tests\/suites\/framework/,
        rationale: `${scriptName} must fail loudly when canonical suite paths are missing.`,
      });
    }
    expectTextNotMatches(vitestConfig, {
      pattern: /passWithNoTests|tests\/suites\/framework/,
      rationale: 'Vitest config must not mask missing canonical suite paths.',
    });
  });

  it('routes contract assertions through rationale helpers', () => {
    const offenders = listContractSpecPaths().flatMap((absolutePath) =>
      findBrittleAssertionOffenders(path.relative(REPO_ROOT, absolutePath)),
    );

    expect(
      offenders,
      'Contract specs must report semantic invariants: use contractAssertions rationale helpers (expectInvariant/expectText*) or named semantic matchers, not raw text matchers or bare boolean .toBe assertions.',
    ).toEqual([]);
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
    expectTextMatches(output, {
      pattern: /No test files found/,
      rationale: 'Missing suite paths must fail with Vitest no-test diagnostics.',
    });
  }, 20_000);

  it('documents command cost tiers from implemented scripts', () => {
    const developmentGuide = readRepoFile('docs/development.md');
    const rows = parseCommandTierRows(developmentGuide);

    expect(rows.get('`npm test` / `npm run test:unit`')).toEqual({
      costTier: 'Fast local',
      scope:
        'Unit tests only; thread pool without per-file isolation; no browser, Docker, Redis, or OTLP dependency.',
    });
    expect(rows.get('`npm run test:contracts`')?.scope).toBe(
      'Package, workflow, infrastructure, and docs contracts.',
    );
    expect(rows.get('`npm run test:integration`')?.scope).toBe(
      'Redis/Testcontainers and OTLP export.',
    );
    expect(
      rows.get('`AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true npm run test:integration`'),
    ).toEqual({
      costTier: 'Blocking real integration',
      scope:
        'Same Redis/OTLP integration suite, but Redis startup/connect failures fail instead of skip.',
    });
    expect(rows.get('`npm run test:coverage`')?.scope).toBe(
      'Critical-module thresholds plus global `src/**` coverage.',
    );
    expect(rows.get('`npm run test:e2e:guarded`')?.scope).toBe(
      'Parallel Chrome proof for guarded self-heal at the default gate.',
    );
    for (const text of [
      'Node Compatibility (Node 20/22/24)',
      'Repository Gates (Node 22)',
      'Risk-Triggered E2E (Chrome)',
      'Risk-weighted coverage floors remain future QE-2 work.',
      'Default local Redis behavior is skip-friendly',
    ]) {
      expectTextIncludes(developmentGuide, {
        text,
        rationale: 'Development guide must preserve public command-tier compatibility wording.',
      });
    }
  });
});
