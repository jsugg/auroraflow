import { createHash } from 'node:crypto';
import type { SelfHealingCandidateSeed } from './candidateTypes';
import type {
  CandidateEvidence,
  RankedSelfHealingCandidate,
  SelfHealingActionType,
  SelfHealingSuggestion,
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from './types';

export interface CandidateScoringInput {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  failedTarget?: string;
  heuristicSuggestions: readonly SelfHealingSuggestion[];
  domCandidates: readonly SelfHealingCandidateSeed[];
  maxCandidates: number;
}

const SCORE_WEIGHTS = Object.freeze({
  roleSignal: 0.28,
  accessibleNameSignal: 0.22,
  uniquenessSignal: 0.25,
  historicalSignal: 0.15,
  similaritySignal: 0.1,
} satisfies Record<keyof SelfHealingSuggestionSignals, number>);

const STRATEGY_RELIABILITY: Readonly<Record<SelfHealingSuggestionStrategy, number>> = Object.freeze(
  {
    original: 0.36,
    testId: 1,
    roleName: 0.9,
    ariaLabel: 0.82,
    text: 0.58,
    cssFallback: 0.42,
    fallback: 0.2,
    registry: 0.88,
    domEvidence: 0.68,
  },
);

function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length > 0),
  );
}

function similaritySignal(candidate: string, original?: string): number {
  if (!original) {
    return 0.5;
  }
  const originalTokens = tokenize(original);
  const candidateTokens = tokenize(candidate);
  if (originalTokens.size === 0 || candidateTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of candidateTokens) {
    if (originalTokens.has(token)) {
      overlap += 1;
    }
  }
  const union = new Set([...originalTokens, ...candidateTokens]).size;
  return clamp(union === 0 ? 0 : overlap / union);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function buildSelfHealingCandidateId({
  pageObjectName,
  actionType,
  failedTarget,
  strategy,
  locator,
}: {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  failedTarget?: string;
  strategy: SelfHealingSuggestionStrategy;
  locator: string;
}): string {
  const failedTargetHash = shortHash(failedTarget ?? 'unknown-target');
  const locatorHash = shortHash(locator);
  return `${pageObjectName}::${actionType}::${failedTargetHash}::${strategy}::${locatorHash}`;
}

function scoreSignals(signals: SelfHealingSuggestionSignals): number {
  const rawScore =
    signals.roleSignal * SCORE_WEIGHTS.roleSignal +
    signals.accessibleNameSignal * SCORE_WEIGHTS.accessibleNameSignal +
    signals.uniquenessSignal * SCORE_WEIGHTS.uniquenessSignal +
    signals.historicalSignal * SCORE_WEIGHTS.historicalSignal +
    signals.similaritySignal * SCORE_WEIGHTS.similaritySignal;
  return Number(clamp(rawScore).toFixed(3));
}

function scoreDomCandidate({
  seed,
  failedTarget,
}: {
  seed: SelfHealingCandidateSeed;
  failedTarget?: string;
}): { score: number; signals: SelfHealingSuggestionSignals } {
  const reliability = STRATEGY_RELIABILITY[seed.strategy];
  const signals: SelfHealingSuggestionSignals = {
    roleSignal: seed.evidence.role || seed.strategy === 'roleName' ? 1 : 0,
    accessibleNameSignal: seed.evidence.accessibleName ? 1 : 0,
    uniquenessSignal: seed.evidence.uniqueInSnapshot ? reliability : reliability * 0.55,
    historicalSignal: 0.5,
    similaritySignal: similaritySignal(seed.locator, failedTarget),
  };

  const visibilityMultiplier = seed.evidence.visible ? 1 : 0.75;
  return {
    score: Number((scoreSignals(signals) * visibilityMultiplier).toFixed(3)),
    signals,
  };
}

function heuristicEvidenceFor(suggestion: SelfHealingSuggestion): CandidateEvidence {
  return {
    source: 'heuristic',
    uniqueInSnapshot: false,
    visible: false,
    matchedAttributes: suggestion.strategy === 'original' ? ['failedTarget'] : ['heuristic'],
  };
}

function toRankedCandidate({
  pageObjectName,
  actionType,
  failedTarget,
  locator,
  strategy,
  score,
  rationale,
  signals,
  evidence,
}: {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  failedTarget?: string;
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  score: number;
  rationale: string;
  signals: SelfHealingSuggestionSignals;
  evidence: CandidateEvidence;
}): RankedSelfHealingCandidate {
  return {
    id: buildSelfHealingCandidateId({
      pageObjectName,
      actionType,
      failedTarget,
      strategy,
      locator,
    }),
    locator,
    strategy,
    score: clamp(score),
    rationale,
    signals,
    evidence,
  };
}

function byCandidatePriority(
  left: RankedSelfHealingCandidate,
  right: RankedSelfHealingCandidate,
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.locator.localeCompare(right.locator);
}

export function rankSelfHealingCandidates({
  pageObjectName,
  actionType,
  failedTarget,
  heuristicSuggestions,
  domCandidates,
  maxCandidates,
}: CandidateScoringInput): RankedSelfHealingCandidate[] {
  const candidatesByLocator = new Map<string, RankedSelfHealingCandidate>();
  const boundedMaxCandidates = Number.isFinite(maxCandidates)
    ? Math.max(1, Math.floor(maxCandidates))
    : 1;

  for (const suggestion of heuristicSuggestions) {
    const candidate = toRankedCandidate({
      pageObjectName,
      actionType,
      failedTarget,
      locator: suggestion.locator,
      strategy: suggestion.strategy,
      score: suggestion.score,
      rationale: suggestion.rationale,
      signals: suggestion.signals,
      evidence: heuristicEvidenceFor(suggestion),
    });
    candidatesByLocator.set(candidate.locator, candidate);
  }

  for (const seed of domCandidates) {
    const scored = scoreDomCandidate({ seed, failedTarget });
    const candidate = toRankedCandidate({
      pageObjectName,
      actionType,
      failedTarget,
      locator: seed.locator,
      strategy: seed.strategy,
      score: scored.score,
      rationale: seed.rationale,
      signals: scored.signals,
      evidence: seed.evidence,
    });
    const existingCandidate = candidatesByLocator.get(candidate.locator);
    if (
      !existingCandidate ||
      candidate.score > existingCandidate.score ||
      (candidate.score === existingCandidate.score && candidate.evidence.source !== 'heuristic')
    ) {
      candidatesByLocator.set(candidate.locator, candidate);
    }
  }

  return [...candidatesByLocator.values()].sort(byCandidatePriority).slice(0, boundedMaxCandidates);
}
