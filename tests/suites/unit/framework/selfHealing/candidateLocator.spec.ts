import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { SelfHealingArtifactSchemaError } from '../../../../../src/framework/selfHealing/artifactSchema';
import {
  CANDIDATE_LOCATOR_SCHEMA_VERSION,
  cssLocator,
  describeCandidateLocator,
  frameLocator,
  labelLocator,
  parseCandidateLocator,
  parseLegacyLocatorString,
  regexName,
  resolveCandidateLocator,
  roleLocator,
  stringName,
  testIdLocator,
  textLocator,
  type CandidateLocator,
} from '../../../../../src/framework/selfHealing/candidateLocator';
import {
  createSeededRandom,
  forAll,
  randomFrom,
  randomInt,
  type Random,
} from '../../../../helpers/propertyTesting';

type ResolverPageMock = {
  getByTestId: ReturnType<typeof vi.fn>;
  getByRole: ReturnType<typeof vi.fn>;
  getByLabel: ReturnType<typeof vi.fn>;
  getByText: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
};

function createResolverPageMock(): ResolverPageMock {
  const sentinel = { sentinel: true };
  return {
    getByTestId: vi.fn().mockReturnValue(sentinel),
    getByRole: vi.fn().mockReturnValue(sentinel),
    getByLabel: vi.fn().mockReturnValue(sentinel),
    getByText: vi.fn().mockReturnValue(sentinel),
    locator: vi.fn().mockReturnValue(sentinel),
  };
}

describe('resolveCandidateLocator (structured guarded path)', () => {
  it('forwards raw values to Playwright without parsing display strings', () => {
    const page = createResolverPageMock();

    resolveCandidateLocator(page as unknown as Page, testIdLocator('submit-order'));
    resolveCandidateLocator(page as unknown as Page, labelLocator("It's saved"));
    resolveCandidateLocator(page as unknown as Page, textLocator("It's saved"));
    resolveCandidateLocator(
      page as unknown as Page,
      cssLocator('button[aria-label="It\'s saved"]'),
    );

    expect(page.getByTestId).toHaveBeenCalledWith('submit-order');
    // The apostrophe-bearing values reach Playwright verbatim — no quote parsing.
    expect(page.getByLabel).toHaveBeenCalledWith("It's saved");
    expect(page.getByText).toHaveBeenCalledWith("It's saved");
    expect(page.locator).toHaveBeenCalledWith('button[aria-label="It\'s saved"]');
  });

  it('resolves role candidates with no name, string name, and regex name', () => {
    const page = createResolverPageMock();

    resolveCandidateLocator(page as unknown as Page, roleLocator('button'));
    resolveCandidateLocator(
      page as unknown as Page,
      roleLocator('button', stringName("It's saved")),
    );
    resolveCandidateLocator(
      page as unknown as Page,
      roleLocator('button', regexName('save changes', 'i')),
    );

    expect(page.getByRole).toHaveBeenNthCalledWith(1, 'button');
    expect(page.getByRole).toHaveBeenNthCalledWith(2, 'button', { name: "It's saved" });
    expect(page.getByRole).toHaveBeenNthCalledWith(3, 'button', { name: /save changes/i });
  });

  it('enters a frame via frameLocator and resolves the inner candidate', () => {
    const innerLocator = { inner: true };
    const frame = { getByTestId: vi.fn().mockReturnValue(innerLocator) };
    const page = { frameLocator: vi.fn().mockReturnValue(frame) };

    const resolved = resolveCandidateLocator(
      page as unknown as Page,
      frameLocator('iframe[title="Checkout iframe"]', testIdLocator('iframe-submit')),
    );

    expect(page.frameLocator).toHaveBeenCalledWith('iframe[title="Checkout iframe"]');
    expect(frame.getByTestId).toHaveBeenCalledWith('iframe-submit');
    expect(resolved).toBe(innerLocator);
  });

  it('returns the Playwright locator instance unchanged', () => {
    const page = createResolverPageMock();
    const locator = resolveCandidateLocator(page as unknown as Page, testIdLocator('x'));
    expect(locator).toBe(page.getByTestId.mock.results[0]?.value);
  });
});

describe('describeCandidateLocator (display emitter)', () => {
  it('renders the canonical Playwright-like display string per kind', () => {
    expect(describeCandidateLocator(testIdLocator('submit-order'))).toBe(
      "page.getByTestId('submit-order')",
    );
    expect(describeCandidateLocator(roleLocator('button'))).toBe("page.getByRole('button')");
    expect(describeCandidateLocator(roleLocator('button', stringName('Submit order')))).toBe(
      "page.getByRole('button', { name: 'Submit order' })",
    );
    expect(describeCandidateLocator(roleLocator('button', stringName("It's saved")))).toBe(
      "page.getByRole('button', { name: \"It's saved\" })",
    );
    expect(describeCandidateLocator(roleLocator('button', regexName('submit', 'i')))).toBe(
      "page.getByRole('button', { name: /submit/i })",
    );
    expect(describeCandidateLocator(labelLocator("It's saved"))).toBe(
      'page.getByLabel("It\'s saved")',
    );
    expect(describeCandidateLocator(textLocator('Submit order'))).toBe(
      "page.getByText('Submit order')",
    );
    expect(describeCandidateLocator(cssLocator('button[aria-label="It\'s saved"]'))).toBe(
      'page.locator(`button[aria-label="It\'s saved"]`)',
    );
    expect(
      describeCandidateLocator(
        frameLocator('iframe[title="Checkout iframe"]', testIdLocator('iframe-submit')),
      ),
    ).toBe("page.frameLocator('iframe[title=\"Checkout iframe\"]').getByTestId('iframe-submit')");
  });

  it('returns null when a value cannot be expressed as one Playwright string literal', () => {
    const triQuote = 'a\'b"c`d';
    expect(describeCandidateLocator(textLocator(triQuote))).toBeNull();
    expect(describeCandidateLocator(testIdLocator(''))).toBeNull();
    expect(describeCandidateLocator(roleLocator('button', stringName(triQuote)))).toBeNull();
  });
});

describe('parseLegacyLocatorString (legacy string read path)', () => {
  it('converts supported Playwright-like strings into structured locators', () => {
    expect(parseLegacyLocatorString("page.getByTestId('submit')")).toEqual(testIdLocator('submit'));
    expect(parseLegacyLocatorString('page.getByText("It\'s saved")')).toEqual(
      textLocator("It's saved"),
    );
    expect(parseLegacyLocatorString("page.getByText('It\\'s saved')")).toEqual(
      textLocator("It's saved"),
    );
    expect(parseLegacyLocatorString('page.getByLabel("Customer email")')).toEqual(
      labelLocator('Customer email'),
    );
    expect(parseLegacyLocatorString("page.locator('button#submit')")).toEqual(
      cssLocator('button#submit'),
    );
    expect(parseLegacyLocatorString("page.getByRole('button')")).toEqual(roleLocator('button'));
    expect(parseLegacyLocatorString('page.getByRole("button", { name: "Save changes" })')).toEqual(
      roleLocator('button', stringName('Save changes')),
    );
    expect(parseLegacyLocatorString("page.getByRole('button', { name: /save changes/i })")).toEqual(
      roleLocator('button', regexName('save changes', 'i')),
    );
  });

  it('parses legacy role locators from adversarial spacing without regex backtracking', () => {
    const repeatedSpaces = ' '.repeat(2_048);

    expect(
      parseLegacyLocatorString(`page.getByRole('button', { name: '${repeatedSpaces}Save' })`),
    ).toEqual(roleLocator('button', stringName(`${repeatedSpaces}Save`)));
    expect(
      parseLegacyLocatorString(`page.getByRole('button', ${repeatedSpaces}{ name: /save/i })`),
    ).toEqual(roleLocator('button', regexName('save', 'i')));
    expect(
      parseLegacyLocatorString(`page.getByRole('button', { name: ${repeatedSpaces} })`),
    ).toBeNull();
  });

  it('rejects malformed role expressions through the linear legacy parser', () => {
    expect(parseLegacyLocatorString('page.getByRole()')).toBeNull();
    expect(parseLegacyLocatorString("page.getByRole('button' { name: 'Save' })")).toBeNull();
    expect(parseLegacyLocatorString("page.getByRole('button', { label: 'Save' })")).toBeNull();
    expect(parseLegacyLocatorString("page.getByRole('button', { name 'Save' })")).toBeNull();
    expect(parseLegacyLocatorString("page.getByRole('button', { name: })")).toBeNull();
  });

  it('keeps legacy malformed role names as string fallbacks', () => {
    expect(parseLegacyLocatorString("page.getByRole('button', { name: /save/1 })")).toEqual(
      roleLocator('button', stringName('/save/1')),
    );
    expect(parseLegacyLocatorString("page.getByRole('button', { name: / })")).toEqual(
      roleLocator('button', stringName('/')),
    );
    expect(parseLegacyLocatorString("page.getByRole('button', { name: 'Save })")).toEqual(
      roleLocator('button', stringName('Save')),
    );
  });

  it('reads same-origin frame candidates into the structured frame model', () => {
    expect(
      parseLegacyLocatorString(
        "page.frameLocator('iframe[title=\"Checkout iframe\"]').getByTestId('iframe-submit')",
      ),
    ).toEqual(frameLocator('iframe[title="Checkout iframe"]', testIdLocator('iframe-submit')));
    expect(
      parseLegacyLocatorString(
        "page.frameLocator('#outer').frameLocator('#inner').getByRole('button', { name: 'Go' })",
      ),
    ).toEqual(
      frameLocator('#outer', frameLocator('#inner', roleLocator('button', stringName('Go')))),
    );
  });

  it('returns null for unsupported expressions', () => {
    expect(parseLegacyLocatorString("customResolver('submit')")).toBeNull();
    expect(parseLegacyLocatorString('#submit-order')).toBeNull();
    expect(parseLegacyLocatorString("page.frameLocator('').getByTestId('submit')")).toBeNull();
    expect(parseLegacyLocatorString("page.frameLocator('iframe')")).toBeNull();
    expect(parseLegacyLocatorString("page.frameLocator('iframe').customResolver('x')")).toBeNull();
  });
});

describe('parseCandidateLocator (artifact reader)', () => {
  it('parses each serialized kind', () => {
    expect(parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'testId', value: 'x' })).toEqual(
      testIdLocator('x'),
    );
    expect(parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'label', value: 'x' })).toEqual(
      labelLocator('x'),
    );
    expect(parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'text', value: 'x' })).toEqual(
      textLocator('x'),
    );
    expect(parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'css', selector: 'a.b' })).toEqual(
      cssLocator('a.b'),
    );
    expect(parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'role', role: 'button' })).toEqual(
      roleLocator('button'),
    );
    expect(
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'role',
        role: 'button',
        name: { kind: 'string', value: 'Save' },
      }),
    ).toEqual(roleLocator('button', stringName('Save')));
    expect(
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'role',
        role: 'button',
        name: { kind: 'regex', source: 'save', flags: 'i' },
      }),
    ).toEqual(roleLocator('button', regexName('save', 'i')));
    expect(
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'frame',
        frameSelector: 'iframe[title="Checkout iframe"]',
        inner: { schemaVersion: '1.0.0', kind: 'testId', value: 'iframe-submit' },
      }),
    ).toEqual(frameLocator('iframe[title="Checkout iframe"]', testIdLocator('iframe-submit')));
  });

  it('rejects malformed structured locators with actionable schema errors', () => {
    expect(() => parseCandidateLocator(null)).toThrow(SelfHealingArtifactSchemaError);
    expect(() => parseCandidateLocator([])).toThrow(SelfHealingArtifactSchemaError);
    expect(() =>
      parseCandidateLocator({ schemaVersion: '0.9.0', kind: 'testId', value: 'x' }),
    ).toThrow(/schemaVersion/);
    expect(() =>
      parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'bogus', value: 'x' }),
    ).toThrow(/kind/);
    expect(() =>
      parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'frame', frameSelector: 'iframe' }),
    ).toThrow(/candidateLocator/);
    expect(() =>
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'frame',
        inner: { schemaVersion: '1.0.0', kind: 'testId', value: 'x' },
      }),
    ).toThrow(/frameSelector/);
    expect(() => parseCandidateLocator({ schemaVersion: '1.0.0', kind: 'testId' })).toThrow(
      SelfHealingArtifactSchemaError,
    );
    expect(() =>
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'role',
        role: 'button',
        name: { kind: 'bogus' },
      }),
    ).toThrow(/name/);
    expect(() =>
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'role',
        role: 'button',
        name: { kind: 'regex', source: '[', flags: 'i' },
      }),
    ).toThrow(/regular expression/);
    expect(() =>
      parseCandidateLocator({
        schemaVersion: '1.0.0',
        kind: 'role',
        role: 'button',
        name: { kind: 'regex', source: 'save', flags: 7 },
      }),
    ).toThrow(/flags/);
  });
});

describe('legacy artifact suggestion strings remain readable', () => {
  it('reconstructs the structured locator from a pre-1.0.0 suggestion string', () => {
    // An old artifact only stored the display string; the legacy read path
    // converts it to the structured model without losing the value.
    const legacySuggestion = { locator: 'page.getByText("It\'s saved")' };
    const structured = parseLegacyLocatorString(legacySuggestion.locator);
    expect(structured).toEqual(textLocator("It's saved"));
  });
});

const SAFE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789 _-';

function randomSafeString(random: Random): string {
  const length = randomInt(random, 1, 12);
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += SAFE_ALPHABET[randomInt(random, 0, SAFE_ALPHABET.length - 1)];
  }
  return value.trim().length === 0 ? 'fallback' : value;
}

function randomNonFrameCandidateLocator(random: Random): CandidateLocator {
  const kind = randomFrom(random, [
    'testId',
    'label',
    'text',
    'css',
    'roleBare',
    'roleString',
  ] as const);
  switch (kind) {
    case 'testId':
      return testIdLocator(randomSafeString(random));
    case 'label':
      return labelLocator(randomSafeString(random));
    case 'text':
      return textLocator(randomSafeString(random));
    case 'css':
      return cssLocator(`.${randomSafeString(random).replace(/\s/g, '')}`);
    case 'roleBare':
      return roleLocator('button');
    case 'roleString':
      return roleLocator('button', stringName(randomSafeString(random)));
  }
}

function randomCandidateLocator(random: Random): CandidateLocator {
  // 1-in-4 runs wrap a non-frame candidate in a same-origin frame so the
  // describe -> parse round trip also exercises frame candidates.
  if (randomInt(random, 0, 3) === 0) {
    return frameLocator(
      `iframe[title="${randomSafeString(random)}"]`,
      randomNonFrameCandidateLocator(random),
    );
  }
  return randomNonFrameCandidateLocator(random);
}

describe('structured locator round-trip property', () => {
  it('describe -> parseLegacyLocatorString recovers the structured locator', () => {
    forAll<CandidateLocator>({
      seed: 0x5eed_020,
      runs: 200,
      generate: randomCandidateLocator,
      property: (locator) => {
        const display = describeCandidateLocator(locator);
        expect(display).not.toBeNull();
        expect(parseLegacyLocatorString(display as string)).toEqual(locator);
      },
    });
  });

  it('parseCandidateLocator recovers a JSON-cloned structured locator', () => {
    const random = createSeededRandom(0x5eed_021);
    for (let run = 0; run < 200; run += 1) {
      const locator = randomCandidateLocator(random);
      const cloned: unknown = JSON.parse(JSON.stringify(locator));
      expect(parseCandidateLocator(cloned)).toEqual(locator);
      expect(locator.schemaVersion).toBe(CANDIDATE_LOCATOR_SCHEMA_VERSION);
    }
  });
});
