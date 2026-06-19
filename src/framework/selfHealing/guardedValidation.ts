import type { Locator, Page } from 'playwright';
import { parseLegacyLocatorString, resolveCandidateLocator } from './candidateLocator';
import type {
  GuardedValidationCandidate,
  GuardedValidationPolicyDecision,
  GuardedValidationSummary,
  SelfHealingActionType,
  SelfHealingSafetyPolicy,
  SelfHealingSuggestion,
} from './types';
import {
  SPAN_NAMES,
  buildGuardedValidationMetricAttributes,
  buildGuardedValidationSpanAttributes,
} from '../observability/attributes';
import { METRIC_NAMES } from '../observability/metricNames';
import { getTelemetry, type AuroraFlowTelemetry } from '../observability/telemetry';

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

/**
 * Legacy string read path: resolves a pre-1.0.0 Playwright-like locator string by
 * converting it to the structured model and resolving that. The structured
 * guarded path ({@link resolveCandidateLocator}) never calls this; it exists so
 * legacy artifacts and arbitrary `original` selectors still resolve. Returns
 * `null` when the expression is not a supported shape.
 */
export function resolveLocatorExpression(page: Page, expression: string): Locator | null {
  const parsed = parseLegacyLocatorString(expression);
  return parsed === null ? null : resolveCandidateLocator(page, parsed);
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

export async function evaluateGuardedSuggestionsDryRun(
  input: GuardedValidationInput,
): Promise<GuardedValidationSummary> {
  const telemetry = getTelemetry();
  return telemetry.runSpan({
    name: SPAN_NAMES.guardedValidation,
    attributes: buildGuardedValidationSpanAttributes({
      actionType: input.actionType,
      minConfidence: input.minConfidence,
      currentUrl: input.currentUrl,
    }),
    task: async (span) => {
      const summary = await evaluateGuardedSuggestionsDryRunInner(input);
      const acceptedCandidate = summary.candidates.find(
        (candidate) => candidate.locator === summary.acceptedLocator,
      );
      span.setAttribute('auroraflow.self_heal.candidate_count', summary.candidates.length);
      span.setAttribute('auroraflow.self_heal.accepted', summary.acceptedLocator !== undefined);
      if (summary.acceptedScore !== undefined) {
        span.setAttribute('auroraflow.self_heal.accepted_score', summary.acceptedScore);
      }
      if (acceptedCandidate !== undefined) {
        span.setAttribute(
          'auroraflow.self_heal.accepted_locator_strategy',
          acceptedCandidate.strategy,
        );
      }
      if (summary.policy.blockedReason !== undefined) {
        span.setAttribute(
          'auroraflow.self_heal.policy_blocked_reason',
          summary.policy.blockedReason,
        );
      }
      recordGuardedValidationMetrics(telemetry, summary);
      return summary;
    },
  });
}

function recordGuardedValidationMetrics(
  telemetry: AuroraFlowTelemetry,
  summary: GuardedValidationSummary,
): void {
  if (summary.candidates.length === 0 && summary.policy.blockedReason !== undefined) {
    telemetry.recordCounter(
      METRIC_NAMES.guardedValidationCandidatesTotal,
      1,
      buildGuardedValidationMetricAttributes({ status: summary.policy.blockedReason }),
    );
    return;
  }

  for (const candidate of summary.candidates) {
    telemetry.recordCounter(
      METRIC_NAMES.guardedValidationCandidatesTotal,
      1,
      buildGuardedValidationMetricAttributes({
        status: candidate.status,
        strategy: candidate.strategy,
      }),
    );
  }
}

async function evaluateGuardedSuggestionsDryRunInner({
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
        candidateLocator: suggestion.candidateLocator,
      });
      continue;
    }

    try {
      // New guarded path: structured candidates resolve without parsing strings.
      // Only legacy/arbitrary candidates fall back to the legacy string read path.
      const locator = suggestion.candidateLocator
        ? resolveCandidateLocator(page, suggestion.candidateLocator)
        : resolveLocatorExpression(page, suggestion.locator);
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
          candidateLocator: suggestion.candidateLocator,
        });
        continue;
      }

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
        candidateLocator: suggestion.candidateLocator,
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
        candidateLocator: suggestion.candidateLocator,
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
