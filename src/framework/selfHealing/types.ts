export type SelfHealingMode = 'off' | 'suggest' | 'guarded';

export type SelfHealingActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'read'
  | 'wait'
  | 'screenshot'
  | 'close'
  | 'unknown';

export interface SelfHealingSafetyPolicy {
  allowedActions: SelfHealingActionType[];
  allowedDomains: string[];
}

export interface SelfHealingConfig {
  mode: SelfHealingMode;
  minConfidence: number;
  safetyPolicy: SelfHealingSafetyPolicy;
}

export type SelfHealingSuggestionStrategy =
  | 'original'
  | 'testId'
  | 'roleName'
  | 'ariaLabel'
  | 'text'
  | 'cssFallback'
  | 'fallback';

export interface SelfHealingSuggestionSignals {
  roleSignal: number;
  accessibleNameSignal: number;
  uniquenessSignal: number;
  historicalSignal: number;
  similaritySignal: number;
}

export interface SelfHealingSuggestion {
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  score: number;
  rationale: string;
  signals: SelfHealingSuggestionSignals;
}

export interface SelfHealingActionContext {
  type: SelfHealingActionType;
  target?: string;
  description: string;
}

export interface CapturedFailureError {
  name: string;
  message: string;
  stack?: string;
}

export type GuardedValidationStatus =
  | 'accepted'
  | 'below_confidence_threshold'
  | 'unsupported_locator_expression'
  | 'no_matches'
  | 'not_visible'
  | 'evaluation_error';

export type GuardedValidationPolicyBlockReason =
  | 'action_not_allowed'
  | 'domain_not_allowed'
  | 'missing_or_invalid_url';

export interface GuardedValidationPolicyDecision {
  actionAllowed: boolean;
  domainAllowed: boolean;
  evaluatedDomain?: string;
  blockedReason?: GuardedValidationPolicyBlockReason;
  allowedActions: SelfHealingActionType[];
  allowedDomains: string[];
}

export interface GuardedValidationCandidate {
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  score: number;
  confidenceEligible: boolean;
  matchedElements: number;
  visible: boolean;
  status: GuardedValidationStatus;
  message?: string;
}

export interface GuardedValidationSummary {
  mode: 'dry-run';
  actionType: SelfHealingActionType;
  minConfidence: number;
  policy: GuardedValidationPolicyDecision;
  acceptedLocator?: string;
  acceptedScore?: number;
  candidates: GuardedValidationCandidate[];
}

export interface CapturedFailureEvent {
  artifactVersion: '1.0.0';
  eventId: string;
  timestamp: string;
  mode: SelfHealingMode;
  minConfidence: number;
  safetyPolicy: SelfHealingSafetyPolicy;
  pageObjectName: string;
  currentUrl?: string;
  screenshotPath?: string;
  action: SelfHealingActionContext;
  error: CapturedFailureError;
  suggestions: SelfHealingSuggestion[];
  guardedValidation?: GuardedValidationSummary;
}
