import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('quality workflow Node compatibility contract', () => {
  it('includes Node 20, 22, and 24 in the verify matrix', () => {
    const qualityWorkflow = readFileSync(
      path.join(process.cwd(), '.github/workflows/quality.yml'),
      'utf8',
    );

    expect(qualityWorkflow).toMatch(/node-version:\s*\[20,\s*22,\s*24\]/);
  });

  it('declares engines range compatible with Node 24', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      engines?: { node?: string };
    };

    expect(packageJson.engines?.node).toBe('>=20 <25');
  });
});
