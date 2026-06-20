import { describe, expect, it } from 'vitest';
import { resolveSelfHealingConfigWithDiagnostics } from '../../../../../src/framework/selfHealing/config';
import {
  forAll,
  randomBoolean,
  randomFrom,
  type Random,
} from '../../../../helpers/propertyTesting';

/**
 * AUR-QE-110 scoped property baseline for self-healing config parsing.
 *
 * Whatever the raw `SELF_HEAL_*` input, the resolved config must stay inside its
 * documented safe ranges and be idempotent. These bounds mirror the hard maxima
 * in `config.ts` (DOM nodes 5000, candidates 50, text length 500).
 */

const SUPPORTED_MODES = new Set(['off', 'suggest', 'guarded']);
const SUPPORTED_REGISTRY_MODES = new Set(['off', 'read', 'write_pending']);
const SUPPORTED_PROMOTION_MODES = new Set(['manual', 'ci_acknowledged']);
const SUPPORTED_ACTIONS = new Set([
  'navigate',
  'click',
  'type',
  'read',
  'wait',
  'screenshot',
  'close',
  'unknown',
]);

const NUMERIC_TOKENS: readonly string[] = [
  '-5',
  '0',
  '1',
  '7',
  '120',
  '500',
  '5000',
  '5001',
  '999999',
  '3.5',
  'NaN',
  'abc',
  '',
  '  10  ',
];

const CONFIDENCE_TOKENS: readonly string[] = [
  '-0.1',
  '0',
  '0.5',
  '0.92',
  '1',
  '1.0001',
  '2',
  'NaN',
  'not-a-number',
  '',
];

const ENUM_TOKENS: readonly string[] = [
  'off',
  'suggest',
  'guarded',
  'read',
  'write_pending',
  'manual',
  'ci_acknowledged',
  'GUARDED',
  'bogus',
  '',
];

const LIST_TOKENS: readonly string[] = [
  'click,type',
  'CLICK, navigate ,bogus',
  'unsupported-only',
  'example.com,sub.example.com',
  '',
];

type Env = Record<string, string | undefined>;

function maybe(random: Random, key: string, pool: readonly string[], env: Env): void {
  if (randomBoolean(random, 0.8)) {
    env[key] = randomFrom(random, pool);
  }
}

function generateEnv(random: Random): Env {
  const env: Env = {};
  maybe(random, 'SELF_HEAL_MODE', ENUM_TOKENS, env);
  maybe(random, 'SELF_HEAL_MIN_CONFIDENCE', CONFIDENCE_TOKENS, env);
  maybe(random, 'SELF_HEAL_MAX_DOM_NODES', NUMERIC_TOKENS, env);
  maybe(random, 'SELF_HEAL_MAX_CANDIDATES', NUMERIC_TOKENS, env);
  maybe(random, 'SELF_HEAL_MAX_TEXT_LENGTH', NUMERIC_TOKENS, env);
  maybe(random, 'SELF_HEAL_REGISTRY_MODE', ENUM_TOKENS, env);
  maybe(random, 'SELF_HEAL_PROMOTION_MODE', ENUM_TOKENS, env);
  maybe(random, 'SELF_HEAL_ALLOWED_ACTIONS', LIST_TOKENS, env);
  maybe(random, 'SELF_HEAL_ALLOWED_DOMAINS', LIST_TOKENS, env);
  maybe(random, 'SELF_HEAL_SAT_ENABLED', ['true', 'false', 'maybe', '1', '0'], env);
  maybe(random, 'SELF_HEAL_SAT_CAPTURE_DOM', ['true', 'false', 'maybe', 'on', 'off'], env);
  return env;
}

function expectBoundedInteger(value: number, max: number): void {
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(1);
  expect(value).toBeLessThanOrEqual(max);
}

describe('resolveSelfHealingConfigWithDiagnostics properties', () => {
  it('always resolves min confidence into [0, 1]', () => {
    forAll({
      seed: 0xc0ffee,
      runs: 300,
      generate: generateEnv,
      property: (env) => {
        const { config } = resolveSelfHealingConfigWithDiagnostics(env);
        expect(Number.isFinite(config.minConfidence)).toBe(true);
        expect(config.minConfidence).toBeGreaterThanOrEqual(0);
        expect(config.minConfidence).toBeLessThanOrEqual(1);
      },
    });
  });

  it('clamps bounded integers into their safe ranges', () => {
    forAll({
      seed: 0xc0ff100,
      runs: 300,
      generate: generateEnv,
      property: (env) => {
        const { config } = resolveSelfHealingConfigWithDiagnostics(env);
        expectBoundedInteger(config.sat.maxDomNodes, 5_000);
        expectBoundedInteger(config.sat.maxCandidates, 50);
        expectBoundedInteger(config.sat.maxTextLength, 500);
      },
    });
  });

  it('only ever resolves supported enum and action values', () => {
    forAll({
      seed: 0xc0ffee2,
      runs: 300,
      generate: generateEnv,
      property: (env) => {
        const { config } = resolveSelfHealingConfigWithDiagnostics(env);
        expect(SUPPORTED_MODES.has(config.mode)).toBe(true);
        expect(SUPPORTED_REGISTRY_MODES.has(config.sat.registryMode)).toBe(true);
        expect(SUPPORTED_PROMOTION_MODES.has(config.sat.promotionMode)).toBe(true);
        expect(config.safetyPolicy.allowedActions.length).toBeGreaterThanOrEqual(1);
        for (const action of config.safetyPolicy.allowedActions) {
          expect(SUPPORTED_ACTIONS.has(action)).toBe(true);
        }
        if (!config.sat.enabled) {
          expect(config.sat.captureDom).toBe(false);
        }
      },
    });
  });

  it('is idempotent for identical environments', () => {
    forAll({
      seed: 0xc0ffee3,
      runs: 200,
      generate: generateEnv,
      property: (env) => {
        const first = resolveSelfHealingConfigWithDiagnostics(env);
        const second = resolveSelfHealingConfigWithDiagnostics(env);
        expect(first.config).toEqual(second.config);
        expect(first.diagnostics).toEqual(second.diagnostics);
        expect(first.strict).toBe(second.strict);
      },
    });
  });
});
