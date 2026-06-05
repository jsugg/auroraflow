import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  });

  it('keeps deterministic example e2e tests tagged for smoke runs', () => {
    const exampleSpecs = [
      'tests/suites/e2e/examples/accessibility.spec.ts',
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
  });

  it('keeps the external playonsports scenario out of smoke tagging', () => {
    const playonsportsSpec = read('tests/suites/e2e/playonsports/example.spec.ts');

    expect(playonsportsSpec).toContain('@external verify navigation menu links are correct');
    expect(playonsportsSpec).not.toContain('@smoke');
  });
});
