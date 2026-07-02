import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectTextIncludes } from '../../../helpers/contractAssertions';

const tsconfig = JSON.parse(readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8')) as {
  readonly compilerOptions?: Readonly<Record<string, unknown>>;
};
const eslintConfig = readFileSync(path.join(process.cwd(), 'eslint.config.mjs'), 'utf8');
const developmentDoc = readFileSync(path.join(process.cwd(), 'docs/development.md'), 'utf8');

describe('incremental strictness contract', () => {
  it('keeps indexed access and optional properties strict', () => {
    expect(tsconfig.compilerOptions).toEqual(
      expect.objectContaining({
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
      }),
    );
  });

  it('keeps type-aware assertion linting enabled and documented', () => {
    expectTextIncludes(eslintConfig, {
      text: "'@typescript-eslint/no-unnecessary-type-assertion': 'error'",
      rationale:
        'Type-aware lint must prevent unnecessary assertions from hiding boundary mistakes.',
    });
    for (const flag of [
      'noUncheckedIndexedAccess',
      'exactOptionalPropertyTypes',
      'unnecessary type assertions',
    ]) {
      expectTextIncludes(developmentDoc, {
        text: flag,
        rationale: 'Contributor docs must describe the enforced incremental strictness slice.',
      });
    }
  });
});
