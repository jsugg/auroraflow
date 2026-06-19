import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import {
  evaluateGuardedSuggestionsDryRun,
  resolveLocatorExpression,
} from '../../../../../src/framework/selfHealing/guardedValidation';
import type {
  SelfHealingSafetyPolicy,
  SelfHealingSuggestion,
} from '../../../../../src/framework/selfHealing/types';
import { CapturingTelemetry } from '../observability/capturingTelemetry';
import {
  createSeededRandom,
  forAll,
  randomFrom,
  randomInt,
} from '../../../../helpers/propertyTesting';

/**
 * AUR-QE-110 scoped property baseline for guarded validation.
 *
 * Two calibration-critical behaviors: the locator-string parser must round-trip
 * the supported `page.*` expressions, and the confidence gate must accept exactly
 * the suggestions whose score is `>=` the minimum confidence.
 */

const SAFE_ARGUMENT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_';

function safeArgument(random: ReturnType<typeof createSeededRandom>): string {
  const length = randomInt(random, 1, 16);
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += SAFE_ARGUMENT_CHARS[randomInt(random, 0, SAFE_ARGUMENT_CHARS.length - 1)];
  }
  return value.trim() || 'fallback';
}

describe('resolveLocatorExpression properties', () => {
  it('round-trips supported single-argument page locator expressions', () => {
    const methods = [
      { name: 'getByTestId', build: (value: string) => `page.getByTestId('${value}')` },
      { name: 'getByText', build: (value: string) => `page.getByText('${value}')` },
      { name: 'getByLabel', build: (value: string) => `page.getByLabel('${value}')` },
      { name: 'locator', build: (value: string) => `page.locator('${value}')` },
    ] as const;

    forAll({
      seed: 0x10ca704,
      runs: 240,
      generate: (random) => ({
        method: randomFrom(random, methods),
        argument: safeArgument(random),
      }),
      property: ({ method, argument }) => {
        const marker = { __locator: `${method.name}:${argument}` };
        const calls: Array<{ method: string; argument: string }> = [];
        const page = {
          getByTestId: vi.fn((value: string) => {
            calls.push({ method: 'getByTestId', argument: value });
            return marker;
          }),
          getByText: vi.fn((value: string) => {
            calls.push({ method: 'getByText', argument: value });
            return marker;
          }),
          getByLabel: vi.fn((value: string) => {
            calls.push({ method: 'getByLabel', argument: value });
            return marker;
          }),
          locator: vi.fn((value: string) => {
            calls.push({ method: 'locator', argument: value });
            return marker;
          }),
          getByRole: vi.fn(),
        } as unknown as Page;

        const resolved = resolveLocatorExpression(page, method.build(argument));

        expect(resolved).toBe(marker);
        expect(calls).toEqual([{ method: method.name, argument }]);
      },
    });
  });

  it('returns null for expressions outside the supported grammar', () => {
    const page = {
      getByTestId: vi.fn(),
      getByText: vi.fn(),
      getByLabel: vi.fn(),
      getByRole: vi.fn(),
      locator: vi.fn(),
    } as unknown as Page;

    forAll({
      seed: 0x10ca705,
      runs: 120,
      generate: (random) =>
        randomFrom(random, [
          'xpath=//div',
          'page.evaluate(() => 1)',
          'page.getByTitle("x")',
          'document.querySelector("a")',
          '',
        ]),
      property: (expression) => {
        expect(resolveLocatorExpression(page, expression)).toBeNull();
      },
    });
  });
});

describe('evaluateGuardedSuggestionsDryRun confidence gate properties', () => {
  afterEach(() => {
    resetTelemetryForTests();
  });

  const minConfidence = 0.92;
  const scorePool = [0, 0.5, 0.91, 0.919, 0.92, 0.93, 1] as const;
  const safetyPolicy: SelfHealingSafetyPolicy = {
    allowedActions: ['click'],
    allowedDomains: [],
  };

  it('marks a suggestion below the threshold iff its score is strictly less than minConfidence', async () => {
    const seed = 0x6a7e;
    const random = createSeededRandom(seed);

    for (let run = 0; run < 120; run += 1) {
      const count = randomInt(random, 1, 5);
      const suggestions: SelfHealingSuggestion[] = Array.from({ length: count }, (_, index) => ({
        // Unsupported locator grammar, so eligible candidates resolve to null
        // (unsupported), isolating the confidence gate as the only discriminator.
        locator: `xpath=//candidate-${index}`,
        strategy: 'testId',
        score: randomFrom(random, scorePool),
        rationale: 'property',
        signals: {
          roleSignal: 1,
          accessibleNameSignal: 1,
          uniquenessSignal: 1,
          historicalSignal: 1,
          similaritySignal: 1,
        },
      }));

      setTelemetryForTests(new CapturingTelemetry());
      const summary = await evaluateGuardedSuggestionsDryRun({
        page: {} as Page,
        actionType: 'click',
        minConfidence,
        suggestions,
        safetyPolicy,
        maxCandidates: count,
      });
      resetTelemetryForTests();

      const context = `seed=${seed}, run=${run}, scores=${JSON.stringify(
        suggestions.map((suggestion) => suggestion.score),
      )}`;

      for (const candidate of summary.candidates) {
        const expectedBelow = candidate.score < minConfidence;
        expect(candidate.confidenceEligible, context).toBe(!expectedBelow);
        if (expectedBelow) {
          expect(candidate.status, context).toBe('below_confidence_threshold');
        } else {
          expect(candidate.status, context).toBe('unsupported_locator_expression');
        }
      }
    }
  });
});
