import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  expectTextExcludes,
  expectTextIncludes,
  expectInvariant,
} from '../../../helpers/contractAssertions';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function parseMakeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const match of makefile.matchAll(/^([A-Za-z0-9_-]+):/gm)) {
    if (match[1] !== undefined) {
      targets.add(match[1]);
    }
  }
  return targets;
}

function parseShellAssignments(script: string): ReadonlyMap<string, string> {
  const assignments = new Map<string, string>();
  for (const match of script.matchAll(/^([A-Z0-9_]+)="([^"]*)"$/gm)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      assignments.set(key, value);
    }
  }
  return assignments;
}

function extractSingleMatch(source: string, pattern: RegExp, invariant: string): string {
  pattern.lastIndex = 0;
  const match = pattern.exec(source);
  const value = match?.[1];
  expectInvariant(value !== undefined, invariant);
  return value ?? '';
}

function extractPlaywrightTestTitles(source: string): readonly string[] {
  return [...source.matchAll(/test\('([^']+)'/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe('smoke selection contract', () => {
  it('uses explicit @smoke filtering in the smoke command', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:smoke']).toBe(
      "npx playwright test --config=configs/playwright.config.ts --project='Google Chrome' --grep @smoke --timeout=60000 --workers=1",
    );
  });

  it('bootstraps pinned repo-local actionlint for local and CI workflow linting', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };
    const workflowLintScript = read('scripts/workflows-lint.mjs');
    const actionlintInstaller = read('scripts/install-actionlint.sh');
    const installerAssignments = parseShellAssignments(actionlintInstaller);
    const qualityWorkflow = readWorkflowModel('.github/workflows/quality.yml');
    const makeTargets = parseMakeTargets(read('Makefile'));

    expect(packageJson.scripts?.['tools:actionlint']).toBe('bash scripts/install-actionlint.sh');
    expect(packageJson.scripts?.['verify:tools']).toBe('npm run tools:actionlint');
    expect(packageJson.scripts?.['workflows:lint']).toBe(
      'npm run tools:actionlint --silent && node scripts/workflows-lint.mjs',
    );
    expect(packageJson.scripts?.verify?.split(/\s+&&\s+/)[0]).toBe('npm run verify:tools');
    expect(
      extractSingleMatch(
        workflowLintScript,
        /const REPO_LOCAL_ACTIONLINT = path\.resolve\('([^']+)'\);/u,
        'Workflow linter must prefer pinned repo-local actionlint binary.',
      ),
    ).toBe('.tools/bin/actionlint');
    expect(installerAssignments.get('ACTIONLINT_VERSION')).toBe('1.7.11');
    expect(
      extractSingleMatch(
        actionlintInstaller,
        /actionlint_1\.7\.11_linux_amd64\.tar\.gz\) expected_sha256="([a-f0-9]{64})"/u,
        'Actionlint bootstrap must verify reviewed Linux amd64 binary checksum.',
      ),
    ).toBe('900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a');
    expect(
      getWorkflowStep(getWorkflowJob(qualityWorkflow, 'repository-gates'), 'Install actionlint')
        .run,
    ).toBe('npm run tools:actionlint');
    expect([...makeTargets]).toEqual(expect.arrayContaining(['tools', 'observability-smoke']));
  });

  it('reports actionable native actionlint setup when fallback is disabled', () => {
    const tempRepo = mkdtempSync(path.join(tmpdir(), 'auroraflow-workflows-lint-'));

    try {
      const result = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, 'scripts/workflows-lint.mjs')],
        {
          cwd: tempRepo,
          encoding: 'utf8',
          env: {
            ...process.env,
            AURORAFLOW_WORKFLOWS_LINT_ALLOW_WASM: 'false',
            PATH: tempRepo,
          },
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(1);
      expectTextIncludes(result.stderr, {
        text: 'Native actionlint was not found.',
        rationale: 'Workflow lint fallback error must explain missing native actionlint.',
      });
      expectTextIncludes(result.stderr, {
        text: 'npm run tools:actionlint',
        rationale: 'Workflow lint fallback error must give actionable bootstrap command.',
      });
      expectTextExcludes(output, {
        text: 'RuntimeError: unreachable',
        rationale: 'Workflow lint fallback must not expose WASM runtime panic to maintainers.',
      });
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  }, 20_000);

  it('keeps deterministic example e2e tests tagged for smoke runs', () => {
    const exampleSpecs = [
      'tests/suites/e2e/examples/accessibility.spec.ts',
      'tests/suites/e2e/examples/example-page.spec.ts',
      'tests/suites/e2e/examples/quickstart.spec.ts',
      'tests/suites/e2e/examples/deterministic-network-mock.spec.ts',
      'tests/suites/e2e/examples/retries-and-timeouts.spec.ts',
    ] as const;

    for (const spec of exampleSpecs) {
      expect(
        extractPlaywrightTestTitles(read(spec)).every((title) => title.startsWith('@smoke ')),
        `${spec} must keep deterministic examples discoverable by smoke grep.`,
      ).toBe(true);
    }
  });

  it('keeps deterministic accessibility checks in the smoke suite', () => {
    const accessibilitySpec = read('tests/suites/e2e/examples/accessibility.spec.ts');
    const accessibilityAssertions = read('tests/suites/e2e/examples/accessibilityAssertions.ts');

    expect(extractPlaywrightTestTitles(accessibilitySpec)).toEqual([
      '@smoke quickstart fixture has no detectable accessibility violations',
      '@smoke reliability fixture has no detectable accessibility violations',
    ]);
    expect([
      ...accessibilitySpec.matchAll(/expectNoAccessibilityViolations\(page\)/gu),
    ]).toHaveLength(2);
    expect(
      extractSingleMatch(
        accessibilityAssertions,
        /import AxeBuilder from '([^']+)';/u,
        'Accessibility helper must use Playwright axe integration.',
      ),
    ).toBe('@axe-core/playwright');
    expect(
      extractSingleMatch(
        accessibilityAssertions,
        /\.include\('([^']+)'\)/u,
        'Accessibility helper must scope scans to main landmark.',
      ),
    ).toBe('main');
    expect(
      read('examples/reliability/fixtures/reliability-app.html').includes('<main>'),
      'Reliability fixture must expose main landmark for scoped accessibility checks.',
    ).toBe(true);
  });

  it('keeps example coverage fixture-backed instead of live external-site backed', () => {
    const examplePageSpec = read('tests/suites/e2e/examples/example-page.spec.ts');
    const legacyExternalSpecPath = path.join(
      REPO_ROOT,
      'tests/suites/e2e/playonsports/example.spec.ts',
    );

    expect(existsSync(legacyExternalSpecPath)).toBe(false);
    expectTextIncludes(examplePageSpec, {
      text: 'deterministic demo fixture',
      rationale: 'Example page smoke coverage must use deterministic local fixture.',
    });
    expectTextExcludes(examplePageSpec, {
      text: '@external',
      rationale: 'Example page smoke coverage must not depend on external-site tests.',
    });
    expectTextExcludes(examplePageSpec, {
      text: 'playonsports.com',
      rationale: 'Example page smoke coverage must not hit legacy external domain.',
    });
  });
});
