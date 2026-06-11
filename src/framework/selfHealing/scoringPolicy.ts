import type { SelfHealingSuggestionSignals, SelfHealingSuggestionStrategy } from './types';

export const SELF_HEALING_SCORE_WEIGHTS = Object.freeze({
  roleSignal: 0.28,
  accessibleNameSignal: 0.22,
  uniquenessSignal: 0.25,
  historicalSignal: 0.15,
  similaritySignal: 0.1,
} satisfies Record<keyof SelfHealingSuggestionSignals, number>);

export const SELF_HEALING_HEURISTIC_STRATEGY_BASE_SIGNAL: Readonly<
  Record<SelfHealingSuggestionStrategy, number>
> = Object.freeze({
  original: 0.36,
  testId: 0.95,
  roleName: 0.78,
  ariaLabel: 0.72,
  text: 0.58,
  cssFallback: 0.42,
  fallback: 0.2,
  registry: 0.88,
  domEvidence: 0.68,
});

export const SELF_HEALING_VALIDATED_STRATEGY_RELIABILITY: Readonly<
  Record<SelfHealingSuggestionStrategy, number>
> = Object.freeze({
  original: 0.36,
  testId: 0.95,
  roleName: 0.9,
  ariaLabel: 0.82,
  text: 0.58,
  cssFallback: 0.42,
  fallback: 0.2,
  registry: 0.88,
  domEvidence: 0.68,
});
