import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('smoke selection contract', () => {
  it('uses explicit @smoke filtering in the smoke command', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:smoke']).toContain('--grep @smoke');
    expect(packageJson.scripts?.['test:smoke']).toContain('--timeout=60000');
    expect(packageJson.scripts?.['test:smoke']).toContain('--workers=1');
  });

  it('bootstraps pinned repo-local actionlint for local and CI workflow linting', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };
    const workflowLintScript = read('scripts/workflows-lint.mjs');
    const actionlintInstaller = read('scripts/install-actionlint.sh');
    const qualityWorkflow = read('.github/workflows/quality.yml');
    const makefile = read('Makefile');

    expect(packageJson.scripts?.['tools:actionlint']).toContain('scripts/install-actionlint.sh');
    expect(packageJson.scripts?.['verify:tools']).toContain('tools:actionlint');
    expect(packageJson.scripts?.['workflows:lint']).toContain('tools:actionlint');
    expect(packageJson.scripts?.verify).toContain('verify:tools');
    expect(workflowLintScript).toContain('.tools/bin/actionlint');
    expect(actionlintInstaller).toContain('ACTIONLINT_VERSION="1.7.11"');
    expect(actionlintInstaller).toContain(
      '900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a',
    );
    expect(qualityWorkflow).toContain('npm run tools:actionlint');
    expect(makefile).toContain('tools:');
    expect(makefile).toContain('observability-smoke:');
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
      expect(result.stderr).toContain('Native actionlint was not found.');
      expect(result.stderr).toContain('npm run tools:actionlint');
      expect(output).not.toContain('RuntimeError: unreachable');
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('keeps deterministic example e2e tests tagged for smoke runs', () => {
    const exampleSpecs = [
      'tests/suites/e2e/examples/accessibility.spec.ts',
      'tests/suites/e2e/examples/example-page.spec.ts',
      'tests/suites/e2e/examples/quickstart.spec.ts',
      'tests/suites/e2e/examples/deterministic-network-mock.spec.ts',
      'tests/suites/e2e/examples/retries-and-timeouts.spec.ts',
    ] as const;

    for (const spec of exampleSpecs) {
      expect(read(spec)).toMatch(/test\('@smoke\s+/);
    }
  });

  it('keeps deterministic accessibility checks in the smoke suite', () => {
    const accessibilitySpec = read('tests/suites/e2e/examples/accessibility.spec.ts');
    const accessibilityAssertions = read('tests/suites/e2e/examples/accessibilityAssertions.ts');

    expect(accessibilitySpec).toContain('expectNoAccessibilityViolations(page)');
    expect(accessibilitySpec).toContain(
      '@smoke quickstart fixture has no detectable accessibility',
    );
    expect(accessibilitySpec).toContain(
      '@smoke reliability fixture has no detectable accessibility',
    );
    expect(accessibilityAssertions).toContain('@axe-core/playwright');
    expect(accessibilityAssertions).toContain(".include('main')");
    expect(read('examples/reliability/fixtures/reliability-app.html')).toContain('<main>');
  });

  it('keeps example coverage fixture-backed instead of live external-site backed', () => {
    const examplePageSpec = read('tests/suites/e2e/examples/example-page.spec.ts');
    const legacyExternalSpecPath = path.join(
      REPO_ROOT,
      'tests/suites/e2e/playonsports/example.spec.ts',
    );

    expect(existsSync(legacyExternalSpecPath)).toBe(false);
    expect(examplePageSpec).toContain('deterministic demo fixture');
    expect(examplePageSpec).not.toContain('@external');
    expect(examplePageSpec).not.toContain('playonsports.com');
  });
});
