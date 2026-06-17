import { expect } from 'vitest';

export interface ProtectedTextAssertion {
  readonly text: string;
  readonly rationale: string;
}

export interface ProtectedPatternAssertion {
  readonly pattern: RegExp;
  readonly rationale: string;
}

export function expectInvariant(condition: boolean, invariant: string): void {
  expect(condition, invariant).toBe(true);
}

export function expectTextIncludes(source: string, assertion: ProtectedTextAssertion): void {
  expectInvariant(source.includes(assertion.text), assertion.rationale);
}

export function expectTextExcludes(source: string, assertion: ProtectedTextAssertion): void {
  expectInvariant(!source.includes(assertion.text), assertion.rationale);
}

export function expectTextMatches(source: string, assertion: ProtectedPatternAssertion): void {
  assertion.pattern.lastIndex = 0;
  expectInvariant(assertion.pattern.test(source), assertion.rationale);
}

export function expectTextNotMatches(source: string, assertion: ProtectedPatternAssertion): void {
  assertion.pattern.lastIndex = 0;
  expectInvariant(!assertion.pattern.test(source), assertion.rationale);
}

export function expectEveryTextMatches(
  values: readonly string[],
  pattern: RegExp,
  invariant: string,
): void {
  expectInvariant(values.length > 0, `${invariant}: at least one value must be present`);
  const invalidValue = values.find((value) => {
    pattern.lastIndex = 0;
    return !pattern.test(value);
  });
  expectInvariant(
    invalidValue === undefined,
    `${invariant}: invalid value ${invalidValue ?? '<none>'}`,
  );
}
