import type { Locator, Page } from 'playwright';
import { SelfHealingArtifactSchemaError } from './artifactSchema';

/**
 * Schema version for the structured {@link CandidateLocator} model (`AUR-IMPL-020`).
 *
 * Stored alongside every serialized locator so the legacy string read path and
 * future upgraders can tell a structured locator from a pre-1.0.0 display string.
 */
export const CANDIDATE_LOCATOR_SCHEMA_VERSION = '1.0.0' as const;

/** Discriminator for the locator strategies the framework can resolve structurally. */
export type CandidateLocatorKind = 'testId' | 'role' | 'label' | 'text' | 'css';

/**
 * Accessible-name matcher for a role candidate. The structured form keeps the raw
 * value (or regex source/flags) so resolution never has to re-parse a string.
 */
export type CandidateLocatorName =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'regex'; readonly source: string; readonly flags: string };

/**
 * Discriminated locator candidate. Each member carries the raw inputs a Playwright
 * `getBy*`/`locator` call needs, so the guarded path resolves locators without
 * parsing display strings. Producers also emit a human-readable display string
 * (see {@link describeCandidateLocator}); the legacy converter
 * ({@link parseLegacyLocatorString}) reconstructs this model from old strings.
 */
export type CandidateLocator =
  | {
      readonly schemaVersion: typeof CANDIDATE_LOCATOR_SCHEMA_VERSION;
      readonly kind: 'testId';
      readonly value: string;
    }
  | {
      readonly schemaVersion: typeof CANDIDATE_LOCATOR_SCHEMA_VERSION;
      readonly kind: 'role';
      readonly role: string;
      readonly name?: CandidateLocatorName;
    }
  | {
      readonly schemaVersion: typeof CANDIDATE_LOCATOR_SCHEMA_VERSION;
      readonly kind: 'label';
      readonly value: string;
    }
  | {
      readonly schemaVersion: typeof CANDIDATE_LOCATOR_SCHEMA_VERSION;
      readonly kind: 'text';
      readonly value: string;
    }
  | {
      readonly schemaVersion: typeof CANDIDATE_LOCATOR_SCHEMA_VERSION;
      readonly kind: 'css';
      readonly selector: string;
    };

/** Builds a `getByTestId` candidate from a raw test-id value. */
export function testIdLocator(value: string): CandidateLocator {
  return { schemaVersion: CANDIDATE_LOCATOR_SCHEMA_VERSION, kind: 'testId', value };
}

/** Builds a `getByRole` candidate, optionally constrained by accessible name. */
export function roleLocator(role: string, name?: CandidateLocatorName): CandidateLocator {
  return name === undefined
    ? { schemaVersion: CANDIDATE_LOCATOR_SCHEMA_VERSION, kind: 'role', role }
    : { schemaVersion: CANDIDATE_LOCATOR_SCHEMA_VERSION, kind: 'role', role, name };
}

/** Builds a `getByLabel` candidate from a raw label value. */
export function labelLocator(value: string): CandidateLocator {
  return { schemaVersion: CANDIDATE_LOCATOR_SCHEMA_VERSION, kind: 'label', value };
}

/** Builds a `getByText` candidate from a raw text value. */
export function textLocator(value: string): CandidateLocator {
  return { schemaVersion: CANDIDATE_LOCATOR_SCHEMA_VERSION, kind: 'text', value };
}

/** Builds a CSS `page.locator` candidate from a raw selector. */
export function cssLocator(selector: string): CandidateLocator {
  return { schemaVersion: CANDIDATE_LOCATOR_SCHEMA_VERSION, kind: 'css', selector };
}

/** Wraps a raw string into a string accessible-name matcher. */
export function stringName(value: string): CandidateLocatorName {
  return { kind: 'string', value };
}

/** Wraps a regex source/flags pair into a regex accessible-name matcher. */
export function regexName(source: string, flags: string): CandidateLocatorName {
  return { kind: 'regex', source, flags };
}

function quoteLiteral(value: string): string | null {
  if (value.length === 0) {
    return null;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes('`') && !value.includes('${')) {
    return `\`${value}\``;
  }
  return null;
}

function describeName(name: CandidateLocatorName): string | null {
  if (name.kind === 'regex') {
    return `/${name.source}/${name.flags}`;
  }
  return quoteLiteral(name.value);
}

/**
 * Renders the Playwright-like display string for a structured locator. Returns
 * `null` when the value cannot be expressed as a single Playwright string literal
 * (it contains a single quote, double quote, and backtick/template marker), which
 * lets producers skip a candidate exactly as the legacy emitter did. Resolution
 * via {@link resolveCandidateLocator} still works for such values.
 */
export function describeCandidateLocator(locator: CandidateLocator): string | null {
  switch (locator.kind) {
    case 'testId': {
      const literal = quoteLiteral(locator.value);
      return literal === null ? null : `page.getByTestId(${literal})`;
    }
    case 'label': {
      const literal = quoteLiteral(locator.value);
      return literal === null ? null : `page.getByLabel(${literal})`;
    }
    case 'text': {
      const literal = quoteLiteral(locator.value);
      return literal === null ? null : `page.getByText(${literal})`;
    }
    case 'css': {
      const literal = quoteLiteral(locator.selector);
      return literal === null ? null : `page.locator(${literal})`;
    }
    case 'role': {
      if (locator.name === undefined) {
        return `page.getByRole('${locator.role}')`;
      }
      const name = describeName(locator.name);
      return name === null ? null : `page.getByRole('${locator.role}', { name: ${name} })`;
    }
  }
}

/**
 * Resolves a structured locator into a Playwright {@link Locator} without parsing
 * any display string. This is the guarded-path resolver introduced by
 * `AUR-IMPL-020`; it switches on the discriminant and forwards raw values, so
 * quote- and apostrophe-bearing names round-trip exactly.
 */
export function resolveCandidateLocator(page: Page, locator: CandidateLocator): Locator {
  switch (locator.kind) {
    case 'testId':
      return page.getByTestId(locator.value);
    case 'label':
      return page.getByLabel(locator.value);
    case 'text':
      return page.getByText(locator.value);
    case 'css':
      return page.locator(locator.selector);
    case 'role': {
      const role = locator.role as Parameters<Page['getByRole']>[0];
      if (locator.name === undefined) {
        return page.getByRole(role);
      }
      const name =
        locator.name.kind === 'regex'
          ? new RegExp(locator.name.source, locator.name.flags)
          : locator.name.value;
      return page.getByRole(role, { name });
    }
  }
}

function parseQuotedStringLiteral(rawValue: string): string | null {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length < 2) {
    return null;
  }

  const quote = trimmedValue[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return null;
  }
  if (trimmedValue[trimmedValue.length - 1] !== quote) {
    return null;
  }

  // Legacy string-DSL quote recovery: the pre-1.0.0 emitter escaped embedded
  // quotes, so the legacy read path unescapes them back into the raw value.
  return trimmedValue
    .slice(1, -1)
    .replace(/\\\\/g, '\\')
    .replace(/\\(['"`])/g, '$1');
}

function parsePageStringArgument(expression: string, methodName: string): string | null {
  const prefix = `page.${methodName}(`;
  if (!expression.startsWith(prefix) || !expression.endsWith(')')) {
    return null;
  }
  return parseQuotedStringLiteral(expression.slice(prefix.length, -1));
}

function parseNameOption(rawValue: string): CandidateLocatorName {
  const regexMatch = rawValue.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    return regexName(regexMatch[1], regexMatch[2]);
  }
  const quotedValue = parseQuotedStringLiteral(rawValue);
  return stringName(quotedValue ?? rawValue.replace(/^['"`]|['"`]$/g, ''));
}

/**
 * Legacy string read path (`AUR-IMPL-020`): converts a pre-1.0.0 Playwright-like
 * locator string into the structured model, or `null` when the expression is not
 * one of the supported `page.getBy*`/`page.locator` shapes. This is the only
 * place that parses locator strings; the guarded path consumes structured
 * locators directly.
 */
export function parseLegacyLocatorString(expression: string): CandidateLocator | null {
  const trimmedExpression = expression.trim();

  const testIdValue = parsePageStringArgument(trimmedExpression, 'getByTestId');
  if (testIdValue !== null) {
    return testIdLocator(testIdValue);
  }

  const textValue = parsePageStringArgument(trimmedExpression, 'getByText');
  if (textValue !== null) {
    return textLocator(textValue);
  }

  const labelValue = parsePageStringArgument(trimmedExpression, 'getByLabel');
  if (labelValue !== null) {
    return labelLocator(labelValue);
  }

  const roleMatch = trimmedExpression.match(
    /^page\.getByRole\((['"`])([^'"`]+)\1(?:,\s*\{\s*name:\s*(.+)\s*\})?\)$/,
  );
  if (roleMatch?.[2]) {
    const role = roleMatch[2];
    const rawNameOption = roleMatch[3];
    return rawNameOption
      ? roleLocator(role, parseNameOption(rawNameOption.trim()))
      : roleLocator(role);
  }

  const locatorValue = parsePageStringArgument(trimmedExpression, 'locator');
  if (locatorValue !== null) {
    return cssLocator(locatorValue);
  }

  return null;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SelfHealingArtifactSchemaError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SelfHealingArtifactSchemaError(`${path}.${key} must be a non-empty string.`);
  }
  return value;
}

function readRegexFlags(record: Record<string, unknown>, path: string): string {
  const value = record.flags;
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new SelfHealingArtifactSchemaError(`${path}.flags must be a string.`);
  }
  return value;
}

function assertValidRegExp(source: string, flags: string, path: string): void {
  try {
    new RegExp(source, flags);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SelfHealingArtifactSchemaError(
      `${path} must be a valid JavaScript regular expression: ${message}`,
    );
  }
}

function parseCandidateLocatorName(raw: unknown): CandidateLocatorName {
  const record = asRecord(raw, 'candidateLocator.name');
  if (record.kind === 'regex') {
    const source = readRequiredString(record, 'source', 'candidateLocator.name');
    const flags = readRegexFlags(record, 'candidateLocator.name');
    assertValidRegExp(source, flags, 'candidateLocator.name');
    return regexName(source, flags);
  }
  if (record.kind === 'string') {
    return stringName(readRequiredString(record, 'value', 'candidateLocator.name'));
  }
  throw new SelfHealingArtifactSchemaError('candidateLocator.name.kind must be string or regex.');
}

/**
 * Validates and parses a serialized structured locator from an artifact. Enforces
 * the {@link CANDIDATE_LOCATOR_SCHEMA_VERSION} and the per-kind required fields,
 * throwing {@link SelfHealingArtifactSchemaError} on malformed input.
 */
export function parseCandidateLocator(raw: unknown): CandidateLocator {
  const record = asRecord(raw, 'candidateLocator');
  if (record.schemaVersion !== CANDIDATE_LOCATOR_SCHEMA_VERSION) {
    throw new SelfHealingArtifactSchemaError(
      `candidateLocator.schemaVersion must be ${CANDIDATE_LOCATOR_SCHEMA_VERSION}. Received: ${String(
        record.schemaVersion,
      )}.`,
    );
  }

  switch (record.kind) {
    case 'testId':
      return testIdLocator(readRequiredString(record, 'value', 'candidateLocator'));
    case 'label':
      return labelLocator(readRequiredString(record, 'value', 'candidateLocator'));
    case 'text':
      return textLocator(readRequiredString(record, 'value', 'candidateLocator'));
    case 'css':
      return cssLocator(readRequiredString(record, 'selector', 'candidateLocator'));
    case 'role': {
      const role = readRequiredString(record, 'role', 'candidateLocator');
      return record.name === undefined
        ? roleLocator(role)
        : roleLocator(role, parseCandidateLocatorName(record.name));
    }
    default:
      throw new SelfHealingArtifactSchemaError(
        'candidateLocator.kind must be testId, role, label, text, or css.',
      );
  }
}
