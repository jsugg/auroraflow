import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DEPENDABOT_PATH = path.join(process.cwd(), '.github/dependabot.yml');

describe('dependabot configuration contract', () => {
  it('defines repository-level dependabot automation config', () => {
    expect(existsSync(DEPENDABOT_PATH)).toBe(true);
  });

  it('covers npm and github-actions ecosystems on a weekly schedule', () => {
    const config = readFileSync(DEPENDABOT_PATH, 'utf8');

    expect(config).toContain('version: 2');
    expect(config).toMatch(/package-ecosystem:\s*['"]npm['"]/);
    expect(config).toMatch(/package-ecosystem:\s*['"]github-actions['"]/);
    expect(config).toMatch(/directory:\s*['"]\/['"]/);
    expect(config).toMatch(/schedule:\s*\n\s*interval:\s*['"]weekly['"]/);
  });

  it('ignores semver-major eslint lane updates that are incompatible with the current toolchain', () => {
    const config = readFileSync(DEPENDABOT_PATH, 'utf8');

    expect(config).toMatch(
      /dependency-name:\s*['"]eslint['"]\s*\n\s*update-types:\s*\n\s*-\s*['"]version-update:semver-major['"]/,
    );
    expect(config).toMatch(
      /dependency-name:\s*['"]@eslint\/js['"]\s*\n\s*update-types:\s*\n\s*-\s*['"]version-update:semver-major['"]/,
    );
  });
});
