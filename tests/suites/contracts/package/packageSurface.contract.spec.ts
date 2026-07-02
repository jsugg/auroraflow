import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectTextIncludes } from '../../../helpers/contractAssertions';
import {
  extractRootExports,
  findDuplicateNames,
  parseStabilityManifest,
} from '../../../helpers/apiStabilitySurface';
import * as rootExports from '../../../../src';

const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  name?: string;
  description?: string;
  type?: string;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  files?: string[];
  typesVersions?: Record<string, Record<string, string[]>>;
  scripts?: Record<string, string>;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('package surface contract', () => {
  it('publishes a named root entrypoint with declarations and curated files', () => {
    expect(packageJson.name).toBe('auroraflow');
    expectTextIncludes(packageJson.description ?? '', {
      text: 'TypeScript Playwright test automation framework',
      rationale: 'npm package description must preserve public discovery wording.',
    });
    expect(packageJson.type).toBe('commonjs');
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.exports?.['.']).toEqual({
      types: './dist/index.d.ts',
      require: './dist/index.js',
      default: './dist/index.js',
    });
    expect(packageJson.exports?.['./playwright']).toEqual({
      types: './dist/playwright.d.ts',
      require: './dist/playwright.js',
      default: './dist/playwright.js',
    });
    expect(packageJson.exports?.['./package.json']).toBe('./package.json');
    expect(packageJson.files).toEqual([
      'dist',
      'docs',
      'schemas',
      'README.md',
      'LICENSE',
      'playwright.js',
      'playwright.d.ts',
    ]);
    expect(packageJson.typesVersions?.['*']?.playwright).toEqual(['playwright.d.ts']);
    expect(packageJson.license).toBe('MIT');
  });

  it('defines build and pack scripts that produce the package artifact surface', () => {
    expect(packageJson.scripts?.clean).toBe(
      "node -e \"require('node:fs').rmSync('dist', { recursive: true, force: true })\"",
    );
    expect(packageJson.scripts?.build).toBe('npm run clean && tsc -p tsconfig.build.json');
    expect(packageJson.scripts?.prepack).toBe('npm run build');
    expect(packageJson.scripts?.['pack:dry-run']).toBe('npm pack --dry-run');
    expect(packageJson.scripts?.['package:consumer-smoke']).toBe(
      'node scripts/package-consumer-smoke.mjs',
    );
    expect(packageJson.scripts?.['package:publint']).toBe('publint');
    expect(packageJson.scripts?.['package:attw']).toBe('attw --pack .');
  });

  it('declares runtime and peer dependencies required by exported APIs', () => {
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        pino: expect.any(String),
        'pino-pretty': expect.any(String),
        redis: expect.any(String),
      }),
    );
    expect(packageJson.peerDependencies).toEqual({
      playwright: '>=1.59 <2',
      '@playwright/test': '>=1.59 <2',
    });
    expect(packageJson.devDependencies).toEqual(
      expect.objectContaining({
        publint: expect.any(String),
        '@arethetypeswrong/cli': expect.any(String),
      }),
    );
  });
});

describe('API stability tier contract', () => {
  const indexSource = readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf8');
  const stabilityDoc = readFileSync(path.join(process.cwd(), 'docs', 'api-stability.md'), 'utf8');
  const inventory = extractRootExports(indexSource, 'src/index.ts');
  const manifest = parseStabilityManifest(stabilityDoc);

  it('keeps the root export inventory and the stability manifest free of duplicates', () => {
    expect(findDuplicateNames(inventory)).toEqual([]);
    expect(findDuplicateNames(manifest)).toEqual([]);
  });

  it('classifies every root export in docs/api-stability.md', () => {
    const classifiedNames = new Set(manifest.map((entry) => entry.name));
    const unclassified = inventory
      .filter((entry) => !classifiedNames.has(entry.name))
      .map((entry) => entry.name);

    expect(unclassified).toEqual([]);
  });

  it('lists no stale or mislabeled manifest entries', () => {
    const inventoryByName = new Map(inventory.map((entry) => [entry.name, entry]));
    const stale = manifest
      .filter((entry) => !inventoryByName.has(entry.name))
      .map((entry) => entry.name);
    const mislabeledKinds = manifest
      .filter((entry) => inventoryByName.get(entry.name)?.kind !== entry.kind)
      .map((entry) => entry.name);

    expect(stale).toEqual([]);
    expect(mislabeledKinds).toEqual([]);
  });

  it('matches the runtime export surface of the package root exactly', () => {
    const declaredRuntimeNames = inventory
      .filter((entry) => entry.kind === 'runtime')
      .map((entry) => entry.name)
      .sort();
    const actualRuntimeNames = Object.keys(rootExports).sort();

    expect(actualRuntimeNames).toEqual(declaredRuntimeNames);
  });
});
