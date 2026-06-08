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

export type SelfHealingRegistryMode = 'off' | 'read' | 'write_pending';

export type SelfHealingPromotionMode = 'manual' | 'ci_acknowledged';

export interface SelfHealingSatConfig {
  enabled: boolean;
  captureDom: boolean;
  maxDomNodes: number;
  maxCandidates: number;
  maxTextLength: number;
  allowedAttributes: string[];
  registryMode: SelfHealingRegistryMode;
  promotionMode: SelfHealingPromotionMode;
}

export interface SelfHealingConfig {
  mode: SelfHealingMode;
  minConfidence: number;
  safetyPolicy: SelfHealingSafetyPolicy;
  sat: SelfHealingSatConfig;
}

export type SelfHealingSuggestionStrategy =
  | 'original'
  | 'testId'
  | 'roleName'
  | 'ariaLabel'
  | 'text'
  | 'cssFallback'
  | 'fallback'
  | 'registry'
  | 'domEvidence';

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
  targetAlias?: string;
  expectedRole?: string;
  expectedName?: string;
  selectorId?: string;
  description: string;
}

export interface DomElementSummary {
  id: string;
  tagName: string;
  attributes: Readonly<Record<string, string>>;
  role?: string;
  accessibleName?: string;
  text?: string;
  visible: boolean;
  enabled?: boolean;
  editable?: boolean;
  depth: number;
  childCount: number;
  parentTagName?: string;
  landmark?: string;
  cssPath?: string;
}

export interface DomSnapshot {
  schemaVersion: '1.0.0';
  capturedAt: string;
  url?: string;
  nodeCount: number;
  truncated: boolean;
  elements: readonly DomElementSummary[];
}

export interface DomSnapshotSummary {
  schemaVersion: '1.0.0';
  capturedAt: string;
  url?: string;
  nodeCount: number;
  truncated: boolean;
  elementCount: number;
  artifactPath?: string;
}

export interface CandidateEvidence {
  elementId?: string;
  source: 'dom' | 'history' | 'heuristic' | 'registry';
  uniqueInSnapshot: boolean;
  visible: boolean;
  accessibleName?: string;
  role?: string;
  matchedAttributes: readonly string[];
}

export interface SelectorCandidateHistorySummary {
  enabled: boolean;
  observations: number;
  loadedCandidates: number;
  warnings: readonly string[];
}

export interface SelectorCandidateHistory {
  candidateId: string;
  attempts: number;
  validated: number;
  guardedApplySucceeded: number;
  guardedApplyFailed: number;
  promoted: number;
  rejected: number;
  lastSeenAt?: string;
  lastSuccessAt?: string;
}

export interface PendingSelectorPromotion {
  eventId: string;
  candidateId: string;
  selectorId: string;
  locator: string;
  requestedAt: string;
  acknowledged: boolean;
}

export interface RankedSelfHealingCandidate {
  id: string;
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  score: number;
  rationale: string;
  signals: SelfHealingSuggestionSignals;
  evidence: CandidateEvidence;
  registryRecordId?: string;
  registryRecordVersion?: number;
  history?: SelectorCandidateHistorySummary;
}

export interface SelfHealingSatAnalysis {
  schemaVersion: '1.0.0';
  enabled: boolean;
  snapshot?: DomSnapshotSummary;
  candidates: readonly RankedSelfHealingCandidate[];
  history: SelectorCandidateHistorySummary;
  selectedCandidateId?: string;
  analysisWarnings: readonly string[];
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

export type GuardedAutoHealSkipReason =
  | 'no_accepted_locator'
  | 'unsupported_action'
  | 'unsupported_locator_expression';

export interface GuardedAutoHealSummary {
  attempted: boolean;
  succeeded: boolean;
  locator?: string;
  skippedReason?: GuardedAutoHealSkipReason;
  errorMessage?: string;
}

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
  enabled?: boolean;
  editable?: boolean;
  stable?: boolean;
  semanticMatch?: boolean;
  failureReason?: string;
  domEvidenceId?: string;
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
  runId: string;
  testId?: string;
  component: string;
  errorCode: string;
  mode: SelfHealingMode;
  minConfidence: number;
  safetyPolicy: SelfHealingSafetyPolicy;
  pageObjectName: string;
  currentUrl?: string;
  screenshotPath?: string;
  action: SelfHealingActionContext;
  error: CapturedFailureError;
  suggestions: SelfHealingSuggestion[];
  sat?: SelfHealingSatAnalysis;
  guardedValidation?: GuardedValidationSummary;
  guardedAutoHeal?: GuardedAutoHealSummary;
}
