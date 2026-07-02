import {
  SelfHealingActionType,
  SelfHealingSuggestion,
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from './types';
import {
  cssLocator,
  describeCandidateLocator,
  labelLocator,
  regexName,
  roleLocator,
  testIdLocator,
  textLocator,
  type CandidateLocator,
} from './candidateLocator';
import { buildSelfHealingSuggestionMetricAttributes } from '../observability/attributes';
import { METRIC_NAMES } from '../observability/metricNames';
import { getTelemetry, type AuroraFlowTelemetry } from '../observability/telemetry';
import {
  SELF_HEALING_HEURISTIC_STRATEGY_BASE_SIGNAL,
  SELF_HEALING_SCORE_WEIGHTS,
} from './scoringPolicy';

export interface SuggestionEngineInput {
  actionType: SelfHealingActionType;
  failedTarget?: string;
  historicalSuccessByLocator?: Readonly<Record<string, number>>;
  maxCandidates?: number;
  telemetry?: AuroraFlowTelemetry;
}

const DEFAULT_MAX_CANDIDATES = 5;

const GENERIC_ACTION_FALLBACK: Readonly<Record<SelfHealingActionType, CandidateLocator>> =
  Object.freeze({
    navigate: cssLocator('main'),
    click: roleLocator('button'),
    type: roleLocator('textbox'),
    read: roleLocator('status'),
    wait: cssLocator('body'),
    screenshot: cssLocator('body'),
    close: cssLocator('body'),
    unknown: cssLocator('body'),
  });

interface CandidateSeed {
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  rationale: string;
  candidateLocator?: CandidateLocator;
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
  const uniqueness = SELF_HEALING_HEURISTIC_STRATEGY_BASE_SIGNAL[strategy];
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
    signals.roleSignal * SELF_HEALING_SCORE_WEIGHTS.roleSignal +
    signals.accessibleNameSignal * SELF_HEALING_SCORE_WEIGHTS.accessibleNameSignal +
    signals.uniquenessSignal * SELF_HEALING_SCORE_WEIGHTS.uniquenessSignal +
    signals.historicalSignal * SELF_HEALING_SCORE_WEIGHTS.historicalSignal +
    signals.similaritySignal * SELF_HEALING_SCORE_WEIGHTS.similaritySignal;

  return {
    score: Number(clamp(rawScore).toFixed(3)),
    signals,
  };
}

function isQuote(value: string | undefined): value is "'" | '"' | '`' {
  return value === "'" || value === '"' || value === '`';
}

function readLeadingStringLiteral(input: string): { value: string; rest: string } | null {
  const quote = input[0];
  if (!isQuote(quote)) {
    return null;
  }

  let value = '';
  for (let index = 1; index < input.length; index += 1) {
    const char = input[index];
    if (char === '\\') {
      const next = input[index + 1];
      if (next !== undefined) {
        value += next;
        index += 1;
        continue;
      }
    }
    if (char === quote) {
      return { value, rest: input.slice(index + 1) };
    }
    value += char;
  }

  return null;
}

function readMethodStringArgument(target: string, methodName: string): string | null {
  const prefix = `${methodName}(`;
  const start = target.toLowerCase().indexOf(prefix.toLowerCase());
  if (start === -1) {
    return null;
  }

  const literal = readLeadingStringLiteral(target.slice(start + prefix.length).trimStart());
  return literal !== null && literal.rest.trimStart().startsWith(')') ? literal.value : null;
}

function extractCssDataTestId(target: string): string | null {
  const prefix = '[data-testid=';
  const valueStart = target.toLowerCase().indexOf(prefix);
  if (valueStart === -1) {
    return null;
  }

  const contentStart = valueStart + prefix.length;
  const quote = target[contentStart];
  if (quote === "'" || quote === '"') {
    const endQuote = target.indexOf(quote, contentStart + 1);
    if (
      endQuote <= contentStart + 1 ||
      !target
        .slice(endQuote + 1)
        .trimStart()
        .startsWith(']')
    ) {
      return null;
    }
    return target.slice(contentStart + 1, endQuote);
  }

  const endBracket = target.indexOf(']', contentStart);
  return endBracket <= contentStart ? null : target.slice(contentStart, endBracket);
}

function extractDataTestId(target: string): string | null {
  const cssDataTestId = extractCssDataTestId(target);
  return cssDataTestId ?? readMethodStringArgument(target, 'getByTestId');
}

function trimBoundaryQuotes(rawValue: string): string {
  let start = 0;
  let end = rawValue.length;

  if (isQuote(rawValue[0])) {
    start = 1;
  }
  if (end > start && isQuote(rawValue[end - 1])) {
    end -= 1;
  }

  return rawValue.slice(start, end);
}

function extractTextSelectorTarget(target: string): string | null {
  const lowerTarget = target.toLowerCase();
  let searchFrom = 0;

  while (searchFrom < target.length) {
    const start = lowerTarget.indexOf('text', searchFrom);
    if (start === -1) {
      return null;
    }

    let index = start + 'text'.length;
    while (target[index] === ' ' || target[index] === '\t') {
      index += 1;
    }
    if (target[index] !== '=') {
      searchFrom = start + 1;
      continue;
    }

    const value = target.slice(index + 1).trim();
    return value.length === 0 ? null : trimBoundaryQuotes(value).trim();
  }

  return null;
}

function extractTextTarget(target: string): string | null {
  const textSelectorTarget = extractTextSelectorTarget(target);
  if (textSelectorTarget !== null) {
    return textSelectorTarget;
  }

  return readMethodStringArgument(target, 'getByText')?.trim() ?? null;
}

function addSeed(targetSeeds: Map<string, CandidateSeed>, seed: CandidateSeed): void {
  if (!targetSeeds.has(seed.locator)) {
    targetSeeds.set(seed.locator, seed);
  }
}

function addStructuredSeed(
  targetSeeds: Map<string, CandidateSeed>,
  candidateLocator: CandidateLocator,
  strategy: SelfHealingSuggestionStrategy,
  rationale: string,
): void {
  const display = describeCandidateLocator(candidateLocator);
  if (display === null) {
    return;
  }
  addSeed(targetSeeds, { locator: display, strategy, rationale, candidateLocator });
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
      addStructuredSeed(
        seeds,
        testIdLocator(dataTestId),
        'testId',
        'Data test IDs are usually resilient across UI refactors.',
      );
    }

    if (normalizedTarget.startsWith('#')) {
      const idToken = normalizedTarget.slice(1);
      const searchToken = toSearchToken(idToken);
      if (searchToken) {
        addStructuredSeed(
          seeds,
          testIdLocator(idToken),
          'testId',
          'Converted id selector into test-id candidate.',
        );
        addStructuredSeed(
          seeds,
          roleLocator(role, regexName(searchToken, 'i')),
          'roleName',
          'Role + accessible name match is robust for interactive elements.',
        );
        addStructuredSeed(
          seeds,
          labelLocator(idToken),
          'ariaLabel',
          'Label-based selector can survive structural CSS changes.',
        );
      }
    }

    const textTarget = extractTextTarget(normalizedTarget);
    if (textTarget) {
      const textSearchToken = toSearchToken(textTarget);
      addStructuredSeed(
        seeds,
        textLocator(textTarget),
        'text',
        'Text selector fallback for visible content.',
      );
      if (textSearchToken) {
        addStructuredSeed(
          seeds,
          roleLocator(role, regexName(textSearchToken, 'i')),
          'roleName',
          'Role + text-derived name candidate inferred from failing selector.',
        );
      }
    }

    const classMatch = normalizedTarget.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch?.[1]) {
      addStructuredSeed(
        seeds,
        cssLocator(`.${classMatch[1]}`),
        'cssFallback',
        'Fallback to a simplified CSS class selector.',
      );
    }
  }

  addStructuredSeed(
    seeds,
    GENERIC_ACTION_FALLBACK[actionType],
    'fallback',
    'Action-specific generic fallback used when no high-confidence candidate exists.',
  );

  return [...seeds.values()];
}

export function generateRankedLocatorSuggestions({
  actionType,
  failedTarget,
  historicalSuccessByLocator = {},
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  telemetry = getTelemetry(),
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
    const suggestion: SelfHealingSuggestion = {
      locator: seed.locator,
      strategy: seed.strategy,
      score: scored.score,
      rationale: seed.rationale,
      signals: scored.signals,
    };
    if (seed.candidateLocator) {
      suggestion.candidateLocator = seed.candidateLocator;
    }
    return suggestion;
  });

  suggestions.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.locator.localeCompare(right.locator);
  });

  const selectedSuggestions = suggestions.slice(0, boundedMax);
  for (const suggestion of selectedSuggestions) {
    telemetry.recordCounter(
      METRIC_NAMES.selfHealingSuggestionsTotal,
      1,
      buildSelfHealingSuggestionMetricAttributes({ strategy: suggestion.strategy }),
    );
  }

  return selectedSuggestions;
}
