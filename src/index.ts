export {
  PageActionError,
  PageActionInputError,
  PageObjectBase,
  type ActionContext,
  type ActionOptions,
  type NavigationOptions,
} from './pageObjects/pageObjectBase';
export { PageFactory, type PageObjectConstructor } from './helpers/pageFactory';
export { retry, wait } from './helpers/helpers';

export {
  LoggerConfigError,
  createChildLogger,
  createConfiguredLogger,
  getMainLogger,
  resolveLoggerRuntimeConfig,
  setLogLevel,
  type LogDestination,
  type Logger,
  type LoggerRuntimeConfig,
} from './utils/logger';

export {
  RedisClient,
  RedisConfigError,
  RedisConnectionError,
  RedisOperationError,
  getRedisClient,
  resetRedisClientForTests,
  resolveRedisRuntimeConfig,
  type RedisCompareAndSetOptions,
  type RedisCompareAndSetResult,
  type RedisClientDriver,
  type RedisRuntimeConfig,
  type RedisScanOptions,
  type RedisSetOptions,
} from './utils/redisClient';

export {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  SelectorRegistryConflictError,
  SelectorRegistryDataError,
  SelectorRegistryRepository,
  SelectorRegistryValidationError,
  buildSelectorRegistryNamespaces,
  type SelectorRegistryNamespaces,
  type SelectorRecord,
  type SelectorStore,
  type SelectorStoreCompareAndSetOptions,
  type SelectorStoreCompareAndSetResult,
  type SelectorStoreSetOptions,
  type SelectorUpsertInput,
  type SelectorUpsertOptions,
} from './data/selectors/selectorRegistry';

export { createRedisSelectorStore } from './data/selectors/redisSelectorStore';

export {
  normalizeOptionalIdentifier,
  resolveCorrelationIdentifiers,
  resolveRunId,
  resolveTestId,
  type CorrelationIdentifiers,
  type CorrelationInput,
} from './framework/observability/correlation';

export {
  SPAN_NAMES,
  buildGuardedAutoHealMetricAttributes,
  buildGuardedValidationMetricAttributes,
  buildGuardedValidationSpanAttributes,
  buildPageActionMetricAttributes,
  buildPageActionSpanAttributes,
  buildRedisOperationMetricAttributes,
  buildRedisOperationSpanAttributes,
  buildSelfHealingArtifactMetricAttributes,
  buildSelfHealingCaptureSpanAttributes,
  buildSelfHealingRegistryWriteMetricAttributes,
  buildSelfHealingSuggestionMetricAttributes,
  hashTelemetryValue,
  type GuardedAutoHealMetricInput,
  type GuardedAutoHealMetricStatus,
  type GuardedValidationMetricInput,
  type GuardedValidationMetricStatus,
  type GuardedValidationTelemetryInput,
  type PageActionMetricStatus,
  type PageActionMetricInput,
  type PageActionTelemetryInput,
  type RedisOperationStatus,
  type RedisOperationTelemetryInput,
  type SelfHealingArtifactMetricInput,
  type SelfHealingCaptureTelemetryInput,
  type SelfHealingRegistryWriteMetricInput,
  type SelfHealingRegistryWriteMetricStatus,
  type SelfHealingRegistryWriteOperation,
  type SelfHealingSuggestionMetricInput,
} from './framework/observability/attributes';

export {
  METRIC_NAMES,
  REQUIRED_METRIC_NAMES,
  type MetricName,
} from './framework/observability/metricNames';

export {
  initializeTelemetry,
  getTelemetry,
  shutdownTelemetry,
  type AuroraFlowTelemetry,
  type TelemetryAttributes,
  type TelemetryAttributeValue,
  type TelemetryDiagnosticLogger,
  type TelemetryLogCorrelation,
  type TelemetryOperationOptions,
  type TelemetrySpan,
  type TelemetrySpanStatus,
} from './framework/observability/telemetry';

export {
  TelemetryConfigError,
  RESOURCE_ATTRIBUTE_NAMES,
  resolveTelemetryConfig,
  type ObservabilityEnvironment,
  type ResourceAttributeName,
  type TelemetryRuntimeConfig,
} from './framework/observability/telemetryConfig';

export {
  PLAYWRIGHT_REPORT_FILE_PREFIX,
  buildFlakinessMarkdown,
  buildFlakinessSummary,
  extractFlakinessCasesFromReport,
  parseFlakinessReportFile,
  type FinalTestStatus,
  type FlakinessSummary,
  type FlakinessTestCase,
  type ProjectFlakinessSummary,
} from './framework/observability/flakinessReport';

export {
  buildSloDashboard,
  buildSloDashboardMarkdown,
  type SelfHealingGovernanceSummary,
  type SloDashboard,
  type SloMetric,
  type SloMetricComparator,
  type SloMetricKey,
  type SloMetricStatus,
  type SloMetricTarget,
} from './framework/observability/sloDashboard';

export {
  AlertPolicyValidationError,
  buildAlertEvaluationMarkdown,
  evaluateAlertPolicy,
  parseAlertPolicy,
  type AlertBreach,
  type AlertEvaluationResult,
  type AlertOperator,
  type AlertPolicy,
  type AlertRule,
  type AlertSeverity,
} from './framework/observability/alertPolicies';

export {
  DEFAULT_OBSERVABILITY_TREND_LIMIT,
  MAX_OBSERVABILITY_TREND_LIMIT,
  OBSERVABILITY_TREND_SCHEMA_VERSION,
  ObservabilityTrendPersistenceError,
  appendObservabilityTrendPoint,
  buildObservabilityTrendPointFromFlakinessSummary,
  buildObservabilityTrendPointFromSloDashboard,
  parseObservabilityTrendPoint,
  readObservabilityTrendPoints,
  resolveTrendLimit,
  resolveTrendOutputPath,
  type ObservabilityTrendGovernance,
  type ObservabilityTrendGuardedAutoHeal,
  type ObservabilityTrendPoint,
  type ObservabilityTrendRates,
  type ObservabilityTrendSlo,
  type ObservabilityTrendSource,
  type ObservabilityTrendTotals,
  type ObservabilityTrendWriteResult,
} from './framework/observability/trends';

export {
  DEFAULT_SELF_HEAL_MAX_CANDIDATES,
  DEFAULT_SELF_HEAL_MAX_DOM_NODES,
  DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  resolveSelfHealingConfig,
} from './framework/selfHealing/config';

export {
  analyzeSelfHealingFailure,
  type SelfHealingAnalysisResult,
  type SelfHealingFailureContext,
} from './framework/selfHealing/analyzer';

export {
  createRedisSelfHealingRegistryRuntime,
  createStoreSelfHealingRegistryRuntime,
  resolveSelfHealingRegistryRuntime,
  type RedisSelfHealingRegistryRuntimeOptions,
  type ResolveSelfHealingRegistryRuntimeOptions,
  type StoreSelfHealingRegistryRuntimeOptions,
} from './framework/selfHealing/registryRuntime';

export {
  DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS,
  StoreSelectorCandidateHistoryRepository,
  type StoreSelectorCandidateHistoryRepositoryOptions,
} from './framework/selfHealing/historyRepository';

export {
  StorePendingSelectorPromotionRepository,
  type StorePendingSelectorPromotionRepositoryOptions,
} from './framework/selfHealing/promotionRepository';

export {
  SelfHealingPromotionWorkflow,
  type ApprovePromotionInput,
  type PromotionWorkflowListQuery,
  type PromotionWorkflowListResult,
  type PromotionWorkflowResult,
  type RejectPromotionInput,
  type RollbackPromotionInput,
  type SelfHealingPromotionWorkflowOptions,
} from './framework/selfHealing/promotionWorkflow';

export {
  DEFAULT_PENDING_SELECTOR_PROMOTION_TTL_SECONDS,
  persistSelfHealingRegistryTelemetry,
  type PersistSelfHealingRegistryTelemetryInput,
} from './framework/selfHealing/registryPersistence';

export {
  SelfHealingArtifactSchemaError,
  parseCapturedFailureEvent,
  parseDomSnapshot,
  parsePendingSelectorPromotion,
  parseSelectorCandidateHistory,
} from './framework/selfHealing/artifactSchema';

export {
  buildSelfHealingCandidateId,
  rankSelfHealingCandidates,
  type CandidateScoringInput,
} from './framework/selfHealing/candidateScoring';

export { type SelfHealingCandidateSeed } from './framework/selfHealing/candidateTypes';

export type {
  PendingSelectorPromotionQuery,
  PendingSelectorPromotionRepository,
  SelectorCandidateHistoryObservation,
  SelectorCandidateHistoryRepository,
  SelectorRegistryEntry,
  SelectorRegistryLookup,
  SelectorRegistryReader,
  SelfHealingRegistryRuntime,
} from './framework/selfHealing/registryContracts';

export {
  extractDomCandidateSeeds,
  type DomCandidateExtractionInput,
} from './framework/selfHealing/domCandidateExtraction';

export {
  captureDomSnapshot,
  normalizeAllowedAttributes,
  normalizeDomText,
  redactDomAttributeValue,
  summarizeDomSnapshot,
  type DomSnapshotOptions,
} from './framework/selfHealing/domSnapshot';

export {
  captureFailureEvent,
  createFileFailureArtifactWriter,
  type CaptureFailureEventInput,
  type FailureArtifactWriter,
} from './framework/selfHealing/failureCapture';

export {
  generateRankedLocatorSuggestions,
  type SuggestionEngineInput,
} from './framework/selfHealing/suggestionEngine';

export {
  evaluateGuardedSuggestionsDryRun,
  resolveLocatorExpression,
  type GuardedValidationInput,
} from './framework/selfHealing/guardedValidation';

export type {
  CapturedFailureError,
  CapturedFailureEvent,
  CandidateEvidence,
  DomElementSummary,
  DomSnapshot,
  DomSnapshotSummary,
  GuardedAutoHealSkipReason,
  GuardedAutoHealSummary,
  GuardedValidationCandidate,
  GuardedValidationPolicyBlockReason,
  GuardedValidationPolicyDecision,
  GuardedValidationStatus,
  GuardedValidationSummary,
  PendingSelectorPromotion,
  PendingSelectorPromotionStatus,
  PendingSelectorPromotionWriteResult,
  RankedSelfHealingCandidate,
  SelectorCandidateHistory,
  SelectorCandidateHistoryWriteResult,
  SelectorCandidateHistorySummary,
  SelfHealingActionContext,
  SelfHealingActionType,
  SelfHealingConfig,
  SelfHealingMode,
  SelfHealingPromotionMode,
  SelfHealingRegistryPersistenceSummary,
  SelfHealingRegistryMode,
  SelfHealingRegistryWriteStatus,
  SelfHealingSafetyPolicy,
  SelfHealingSatAnalysis,
  SelfHealingSatConfig,
  SelfHealingSuggestion,
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from './framework/selfHealing/types';
