import type { Locator, Page } from 'playwright';
import type {
  GuardedValidationCandidate,
  GuardedValidationPolicyDecision,
  GuardedValidationSummary,
  SelfHealingActionType,
  SelfHealingSafetyPolicy,
  SelfHealingSuggestion,
} from './types';

export interface GuardedValidationInput {
  page: Page;
  actionType: SelfHealingActionType;
  minConfidence: number;
  suggestions: ReadonlyArray<SelfHealingSuggestion>;
  currentUrl?: string;
  safetyPolicy: SelfHealingSafetyPolicy;
  maxCandidates?: number;
}

const DEFAULT_MAX_GUARDED_CANDIDATES = 5;

function toBoundedCandidateLimit(rawValue: number | undefined): number {
  if (rawValue === undefined) {
    return DEFAULT_MAX_GUARDED_CANDIDATES;
  }
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_MAX_GUARDED_CANDIDATES;
  }
  return Math.max(1, Math.floor(rawValue));
}

function resolveNameOption(rawValue: string): string | RegExp {
  const regexMatch = rawValue.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    return new RegExp(regexMatch[1], regexMatch[2]);
  }
  return rawValue.replace(/^['"`]|['"`]$/g, '');
}

function resolveLocatorFromExpression(page: Page, expression: string): Locator | null {
  const trimmedExpression = expression.trim();

  const testIdMatch = trimmedExpression.match(/^page\.getByTestId\((['"`])([^'"`]+)\1\)$/);
  if (testIdMatch?.[2]) {
    return page.getByTestId(testIdMatch[2]);
  }

  const textMatch = trimmedExpression.match(/^page\.getByText\((['"`])([^'"`]+)\1\)$/);
  if (textMatch?.[2]) {
    return page.getByText(textMatch[2]);
  }

  const labelMatch = trimmedExpression.match(/^page\.getByLabel\((['"`])([^'"`]+)\1\)$/);
  if (labelMatch?.[2]) {
    return page.getByLabel(labelMatch[2]);
  }

  const roleMatch = trimmedExpression.match(
    /^page\.getByRole\((['"`])([^'"`]+)\1(?:,\s*\{\s*name:\s*(.+)\s*\})?\)$/,
  );
  if (roleMatch?.[2]) {
    const role = roleMatch[2] as Parameters<Page['getByRole']>[0];
    const rawNameOption = roleMatch[3];
    if (!rawNameOption) {
      return page.getByRole(role);
    }
    const name = resolveNameOption(rawNameOption.trim());
    return page.getByRole(role, { name });
  }

  const locatorMatch = trimmedExpression.match(/^page\.locator\((['"`])(.+)\1\)$/);
  if (locatorMatch?.[2]) {
    return page.locator(locatorMatch[2]);
  }

  return null;
}

function bySuggestionPriority(left: SelfHealingSuggestion, right: SelfHealingSuggestion): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.locator.localeCompare(right.locator);
}

function parseCurrentHost(currentUrl: string | undefined): string | null {
  if (!currentUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(currentUrl);
    return parsedUrl.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedDomain(currentHost: string, allowedDomains: ReadonlyArray<string>): boolean {
  return allowedDomains.some((allowedDomain) => {
    const normalizedDomain = allowedDomain.toLowerCase();
    return currentHost === normalizedDomain || currentHost.endsWith(`.${normalizedDomain}`);
  });
}

function createPolicyDecision({
  actionType,
  currentUrl,
  safetyPolicy,
}: {
  actionType: SelfHealingActionType;
  currentUrl?: string;
  safetyPolicy: SelfHealingSafetyPolicy;
}): GuardedValidationPolicyDecision {
  const allowedActions = [...safetyPolicy.allowedActions];
  const allowedDomains = [...safetyPolicy.allowedDomains];
  const actionAllowed = allowedActions.includes(actionType);
  if (!actionAllowed) {
    return {
      actionAllowed: false,
      domainAllowed: false,
      blockedReason: 'action_not_allowed',
      allowedActions,
      allowedDomains,
    };
  }

  if (allowedDomains.length === 0) {
    return {
      actionAllowed: true,
      domainAllowed: true,
      allowedActions,
      allowedDomains,
    };
  }

  const currentHost = parseCurrentHost(currentUrl);
  if (!currentHost) {
    return {
      actionAllowed: true,
      domainAllowed: false,
      blockedReason: 'missing_or_invalid_url',
      allowedActions,
      allowedDomains,
    };
  }

  const domainAllowed = isAllowedDomain(currentHost, allowedDomains);
  return {
    actionAllowed: true,
    domainAllowed,
    evaluatedDomain: currentHost,
    blockedReason: domainAllowed ? undefined : 'domain_not_allowed',
    allowedActions,
    allowedDomains,
  };
}

export async function evaluateGuardedSuggestionsDryRun({
  page,
  actionType,
  minConfidence,
  suggestions,
  currentUrl,
  safetyPolicy,
  maxCandidates,
}: GuardedValidationInput): Promise<GuardedValidationSummary> {
  const policy = createPolicyDecision({ actionType, currentUrl, safetyPolicy });
  if (policy.blockedReason) {
    return {
      mode: 'dry-run',
      actionType,
      minConfidence,
      policy,
      candidates: [],
    };
  }

  const boundedLimit = toBoundedCandidateLimit(maxCandidates);
  const candidates: GuardedValidationCandidate[] = [];
  let acceptedLocator: string | undefined;
  let acceptedScore: number | undefined;

  const rankedSuggestions = [...suggestions].sort(bySuggestionPriority).slice(0, boundedLimit);

  for (const suggestion of rankedSuggestions) {
    const confidenceEligible = suggestion.score >= minConfidence;
    if (!confidenceEligible) {
      candidates.push({
        locator: suggestion.locator,
        strategy: suggestion.strategy,
        score: suggestion.score,
        confidenceEligible: false,
        matchedElements: 0,
        visible: false,
        status: 'below_confidence_threshold',
        message: `Score ${suggestion.score.toFixed(3)} is below min confidence ${minConfidence.toFixed(3)}.`,
      });
      continue;
    }

    const locator = resolveLocatorFromExpression(page, suggestion.locator);
    if (!locator) {
      candidates.push({
        locator: suggestion.locator,
        strategy: suggestion.strategy,
        score: suggestion.score,
        confidenceEligible: true,
        matchedElements: 0,
        visible: false,
        status: 'unsupported_locator_expression',
        message: 'Unsupported locator expression for guarded validation.',
      });
      continue;
    }

    try {
      const matchedElements = await locator.count();
      const visible =
        matchedElements > 0
          ? await locator
              .first()
              .isVisible()
              .catch(() => false)
          : false;

      if (acceptedLocator === undefined && matchedElements > 0 && visible) {
        acceptedLocator = suggestion.locator;
        acceptedScore = suggestion.score;
      }

      candidates.push({
        locator: suggestion.locator,
        strategy: suggestion.strategy,
        score: suggestion.score,
        confidenceEligible: true,
        matchedElements,
        visible,
        status: matchedElements === 0 ? 'no_matches' : visible ? 'accepted' : 'not_visible',
      });
    } catch (error: unknown) {
      candidates.push({
        locator: suggestion.locator,
        strategy: suggestion.strategy,
        score: suggestion.score,
        confidenceEligible: true,
        matchedElements: 0,
        visible: false,
        status: 'evaluation_error',
        message: error instanceof Error ? error.message : 'Unknown guarded validation error.',
      });
    }
  }

  return {
    mode: 'dry-run',
    actionType,
    minConfidence,
    policy,
    acceptedLocator,
    acceptedScore,
    candidates,
  };
}
