import { createHash } from 'node:crypto';
import type { SelfHealingCandidateSeed } from './candidateTypes';
import type { SelectorRegistryEntry } from './registryContracts';
import type {
  CandidateEvidence,
  RankedSelfHealingCandidate,
  SelectorCandidateHistory,
  SelectorCandidateHistorySummary,
  SelfHealingActionType,
  SelfHealingSuggestion,
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from './types';

export interface CandidateScoringInput {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  failedTarget?: string;
  selectorId?: string;
  heuristicSuggestions: readonly SelfHealingSuggestion[];
  domCandidates: readonly SelfHealingCandidateSeed[];
  registryCandidates?: readonly SelectorRegistryEntry[];
  candidateHistories?: ReadonlyMap<string, SelectorCandidateHistory>;
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
  selectorId,
  strategy,
  locator,
}: {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  failedTarget?: string;
  selectorId?: string;
  strategy: SelfHealingSuggestionStrategy;
  locator: string;
}): string {
  if (selectorId) {
    const selectorIdHash = shortHash(selectorId);
    const locatorHash = shortHash(locator);
    return `v2::${pageObjectName}::${actionType}::${selectorIdHash}::${strategy}::${locatorHash}`;
  }

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

function registryEvidenceFor(entry: SelectorRegistryEntry): CandidateEvidence {
  return {
    source: 'registry',
    uniqueInSnapshot: false,
    visible: false,
    matchedAttributes: [`selectorRegistry:${entry.id}`],
  };
}

function historySignal(history: SelectorCandidateHistory): number {
  const positiveSignals = history.validated + history.guardedApplySucceeded + history.promoted * 2;
  const negativeSignals = history.guardedApplyFailed + history.rejected * 2;
  const signalCount = positiveSignals + negativeSignals;
  if (history.attempts === 0 && signalCount === 0) {
    return 0.5;
  }

  const confidence = (positiveSignals + 1) / (signalCount + 2);
  const observationWeight = Math.min(Math.max(history.attempts, signalCount), 10) / 10;
  return clamp(0.5 * (1 - observationWeight) + confidence * observationWeight);
}

function summarizeHistory(history: SelectorCandidateHistory): SelectorCandidateHistorySummary {
  return {
    enabled: true,
    observations: history.attempts,
    loadedCandidates: 1,
    warnings: [],
  };
}

function applyHistory(
  candidate: RankedSelfHealingCandidate,
  history: SelectorCandidateHistory | undefined,
): RankedSelfHealingCandidate {
  if (!history) {
    return candidate;
  }

  const historicalSignal = historySignal(history);
  const signals: SelfHealingSuggestionSignals = {
    ...candidate.signals,
    historicalSignal,
  };
  const scoreDelta =
    (historicalSignal - candidate.signals.historicalSignal) * SCORE_WEIGHTS.historicalSignal;

  return {
    ...candidate,
    score: Number(clamp(candidate.score + scoreDelta).toFixed(3)),
    signals,
    history: summarizeHistory(history),
  };
}

function scoreRegistryCandidate({
  entry,
  failedTarget,
}: {
  entry: SelectorRegistryEntry;
  failedTarget?: string;
}): { score: number; signals: SelfHealingSuggestionSignals } {
  const confidence = clamp(entry.confidence ?? STRATEGY_RELIABILITY.registry);
  const signals: SelfHealingSuggestionSignals = {
    roleSignal: 0,
    accessibleNameSignal: 0,
    uniquenessSignal: STRATEGY_RELIABILITY.registry,
    historicalSignal: 0.5,
    similaritySignal: similaritySignal(entry.locator, failedTarget),
  };

  return {
    score: Number(clamp(Math.max(scoreSignals(signals), confidence)).toFixed(3)),
    signals,
  };
}

function toRankedCandidate({
  pageObjectName,
  actionType,
  failedTarget,
  selectorId,
  locator,
  strategy,
  score,
  rationale,
  signals,
  evidence,
  history,
  registryRecordId,
  registryRecordVersion,
}: {
  pageObjectName: string;
  actionType: SelfHealingActionType;
  failedTarget?: string;
  selectorId?: string;
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  score: number;
  rationale: string;
  signals: SelfHealingSuggestionSignals;
  evidence: CandidateEvidence;
  history?: SelectorCandidateHistory;
  registryRecordId?: string;
  registryRecordVersion?: number;
}): RankedSelfHealingCandidate {
  const candidate = {
    id: buildSelfHealingCandidateId({
      pageObjectName,
      actionType,
      failedTarget,
      selectorId,
      strategy,
      locator,
    }),
    locator,
    strategy,
    score: clamp(score),
    rationale,
    signals,
    evidence,
    registryRecordId,
    registryRecordVersion,
  };
  return applyHistory(candidate, history);
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
  selectorId,
  heuristicSuggestions,
  domCandidates,
  registryCandidates = [],
  candidateHistories,
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
      selectorId,
      locator: suggestion.locator,
      strategy: suggestion.strategy,
      score: suggestion.score,
      rationale: suggestion.rationale,
      signals: suggestion.signals,
      evidence: heuristicEvidenceFor(suggestion),
      history: candidateHistories?.get(
        buildSelfHealingCandidateId({
          pageObjectName,
          actionType,
          failedTarget,
          selectorId,
          strategy: suggestion.strategy,
          locator: suggestion.locator,
        }),
      ),
    });
    candidatesByLocator.set(candidate.locator, candidate);
  }

  for (const seed of domCandidates) {
    const scored = scoreDomCandidate({ seed, failedTarget });
    const candidate = toRankedCandidate({
      pageObjectName,
      actionType,
      failedTarget,
      selectorId,
      locator: seed.locator,
      strategy: seed.strategy,
      score: scored.score,
      rationale: seed.rationale,
      signals: scored.signals,
      evidence: seed.evidence,
      history: candidateHistories?.get(
        buildSelfHealingCandidateId({
          pageObjectName,
          actionType,
          failedTarget,
          selectorId,
          strategy: seed.strategy,
          locator: seed.locator,
        }),
      ),
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

  for (const entry of registryCandidates) {
    const scored = scoreRegistryCandidate({ entry, failedTarget });
    const candidate = toRankedCandidate({
      pageObjectName,
      actionType,
      failedTarget,
      selectorId: selectorId ?? entry.id,
      locator: entry.locator,
      strategy: 'registry',
      score: scored.score,
      rationale: `Registry selector ${entry.id} version ${entry.version} matched the failed action context.`,
      signals: scored.signals,
      evidence: registryEvidenceFor(entry),
      history: candidateHistories?.get(
        buildSelfHealingCandidateId({
          pageObjectName,
          actionType,
          failedTarget,
          selectorId: selectorId ?? entry.id,
          strategy: 'registry',
          locator: entry.locator,
        }),
      ),
      registryRecordId: entry.id,
      registryRecordVersion: entry.version,
    });
    const existingCandidate = candidatesByLocator.get(candidate.locator);
    if (
      !existingCandidate ||
      candidate.score > existingCandidate.score ||
      (candidate.score === existingCandidate.score && candidate.evidence.source === 'registry')
    ) {
      candidatesByLocator.set(candidate.locator, candidate);
    }
  }

  return [...candidatesByLocator.values()].sort(byCandidatePriority).slice(0, boundedMaxCandidates);
}
