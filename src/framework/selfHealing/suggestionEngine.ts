import {
  SelfHealingActionType,
  SelfHealingSuggestion,
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from './types';

export interface SuggestionEngineInput {
  actionType: SelfHealingActionType;
  failedTarget?: string;
  historicalSuccessByLocator?: Readonly<Record<string, number>>;
  maxCandidates?: number;
}

const DEFAULT_MAX_CANDIDATES = 5;

const SCORE_WEIGHTS = Object.freeze({
  roleSignal: 0.28,
  accessibleNameSignal: 0.22,
  uniquenessSignal: 0.25,
  historicalSignal: 0.15,
  similaritySignal: 0.1,
} satisfies Record<keyof SelfHealingSuggestionSignals, number>);

const STRATEGY_BASE_SIGNAL: Readonly<Record<SelfHealingSuggestionStrategy, number>> = Object.freeze(
  {
    original: 0.36,
    testId: 0.95,
    roleName: 0.78,
    ariaLabel: 0.72,
    text: 0.58,
    cssFallback: 0.42,
    fallback: 0.2,
  },
);

const GENERIC_ACTION_FALLBACK: Readonly<Record<SelfHealingActionType, string>> = Object.freeze({
  navigate: "page.locator('main')",
  click: "page.getByRole('button')",
  type: "page.getByRole('textbox')",
  read: "page.getByRole('status')",
  wait: "page.locator('body')",
  screenshot: "page.locator('body')",
  close: "page.locator('body')",
  unknown: "page.locator('body')",
});

interface CandidateSeed {
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  rationale: string;
}

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

function toSearchToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0);
  return new Set(tokens);
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

function roleForAction(actionType: SelfHealingActionType): string {
  if (actionType === 'type') {
    return 'textbox';
  }
  if (actionType === 'read') {
    return 'status';
  }
  return 'button';
}

function scoreSuggestion({
  strategy,
  locator,
  failedTarget,
  historicalSuccessByLocator,
}: {
  strategy: SelfHealingSuggestionStrategy;
  locator: string;
  failedTarget?: string;
  historicalSuccessByLocator: Readonly<Record<string, number>>;
}): { score: number; signals: SelfHealingSuggestionSignals } {
  const hasRole = strategy === 'roleName' ? 1 : 0;
  const hasAccessibleName =
    strategy === 'roleName' || strategy === 'ariaLabel' || strategy === 'text' ? 1 : 0;
  const uniqueness = STRATEGY_BASE_SIGNAL[strategy];
  const historicalSuccess = clamp(historicalSuccessByLocator[locator] ?? 0.5);
  const lexicalSimilarity = similaritySignal(locator, failedTarget);

  const signals: SelfHealingSuggestionSignals = {
    roleSignal: hasRole,
    accessibleNameSignal: hasAccessibleName,
    uniquenessSignal: uniqueness,
    historicalSignal: historicalSuccess,
    similaritySignal: lexicalSimilarity,
  };

  const rawScore =
    signals.roleSignal * SCORE_WEIGHTS.roleSignal +
    signals.accessibleNameSignal * SCORE_WEIGHTS.accessibleNameSignal +
    signals.uniquenessSignal * SCORE_WEIGHTS.uniquenessSignal +
    signals.historicalSignal * SCORE_WEIGHTS.historicalSignal +
    signals.similaritySignal * SCORE_WEIGHTS.similaritySignal;

  return {
    score: Number(clamp(rawScore).toFixed(3)),
    signals,
  };
}

function extractDataTestId(target: string): string | null {
  const cssMatch = target.match(/\[data-testid=(['"]?)([^'"\]]+)\1\]/i);
  if (cssMatch?.[2]) {
    return cssMatch[2];
  }

  const getByTestIdMatch = target.match(/getByTestId\((['"`])([^'"`]+)\1\)/i);
  if (getByTestIdMatch?.[2]) {
    return getByTestIdMatch[2];
  }

  return null;
}

function extractTextTarget(target: string): string | null {
  const textSelectorMatch = target.match(/text\s*=\s*(.+)$/i);
  if (textSelectorMatch?.[1]) {
    return textSelectorMatch[1].replace(/^['"`]|['"`]$/g, '').trim();
  }

  const getByTextMatch = target.match(/getByText\((['"`])([^'"`]+)\1\)/i);
  if (getByTextMatch?.[2]) {
    return getByTextMatch[2].trim();
  }

  return null;
}

function addSeed(targetSeeds: Map<string, CandidateSeed>, seed: CandidateSeed): void {
  if (!targetSeeds.has(seed.locator)) {
    targetSeeds.set(seed.locator, seed);
  }
}

function createSeeds({
  actionType,
  failedTarget,
}: {
  actionType: SelfHealingActionType;
  failedTarget?: string;
}): CandidateSeed[] {
  const seeds = new Map<string, CandidateSeed>();
  const normalizedTarget = failedTarget?.trim();
  const role = roleForAction(actionType);

  if (normalizedTarget) {
    addSeed(seeds, {
      locator: normalizedTarget,
      strategy: 'original',
      rationale: 'Original failed locator retained for reference and replay.',
    });

    const dataTestId = extractDataTestId(normalizedTarget);
    if (dataTestId) {
      addSeed(seeds, {
        locator: `page.getByTestId('${dataTestId}')`,
        strategy: 'testId',
        rationale: 'Data test IDs are usually resilient across UI refactors.',
      });
    }

    if (normalizedTarget.startsWith('#')) {
      const idToken = normalizedTarget.slice(1);
      const searchToken = toSearchToken(idToken);
      if (searchToken) {
        addSeed(seeds, {
          locator: `page.getByTestId('${idToken}')`,
          strategy: 'testId',
          rationale: 'Converted id selector into test-id candidate.',
        });
        addSeed(seeds, {
          locator: `page.getByRole('${role}', { name: /${searchToken}/i })`,
          strategy: 'roleName',
          rationale: 'Role + accessible name match is robust for interactive elements.',
        });
        addSeed(seeds, {
          locator: `page.getByLabel('${idToken}')`,
          strategy: 'ariaLabel',
          rationale: 'Label-based selector can survive structural CSS changes.',
        });
      }
    }

    const textTarget = extractTextTarget(normalizedTarget);
    if (textTarget) {
      const textSearchToken = toSearchToken(textTarget);
      addSeed(seeds, {
        locator: `page.getByText('${textTarget}')`,
        strategy: 'text',
        rationale: 'Text selector fallback for visible content.',
      });
      if (textSearchToken) {
        addSeed(seeds, {
          locator: `page.getByRole('${role}', { name: /${textSearchToken}/i })`,
          strategy: 'roleName',
          rationale: 'Role + text-derived name candidate inferred from failing selector.',
        });
      }
    }

    const classMatch = normalizedTarget.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch?.[1]) {
      addSeed(seeds, {
        locator: `page.locator('.${classMatch[1]}')`,
        strategy: 'cssFallback',
        rationale: 'Fallback to a simplified CSS class selector.',
      });
    }
  }

  addSeed(seeds, {
    locator: GENERIC_ACTION_FALLBACK[actionType],
    strategy: 'fallback',
    rationale: 'Action-specific generic fallback used when no high-confidence candidate exists.',
  });

  return [...seeds.values()];
}

export function generateRankedLocatorSuggestions({
  actionType,
  failedTarget,
  historicalSuccessByLocator = {},
  maxCandidates = DEFAULT_MAX_CANDIDATES,
}: SuggestionEngineInput): SelfHealingSuggestion[] {
  const boundedMax = Number.isFinite(maxCandidates)
    ? Math.max(1, Math.floor(maxCandidates))
    : DEFAULT_MAX_CANDIDATES;

  const suggestions = createSeeds({ actionType, failedTarget }).map((seed) => {
    const scored = scoreSuggestion({
      strategy: seed.strategy,
      locator: seed.locator,
      failedTarget,
      historicalSuccessByLocator,
    });
    return {
      locator: seed.locator,
      strategy: seed.strategy,
      score: scored.score,
      rationale: seed.rationale,
      signals: scored.signals,
    };
  });

  suggestions.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.locator.localeCompare(right.locator);
  });

  return suggestions.slice(0, boundedMax);
}
