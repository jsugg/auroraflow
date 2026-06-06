export {
  PageActionError,
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
  type RedisClientDriver,
  type RedisRuntimeConfig,
  type RedisScanOptions,
  type RedisSetOptions,
} from './utils/redisClient';

export {
  SelectorRegistryDataError,
  SelectorRegistryRepository,
  SelectorRegistryValidationError,
  type SelectorRecord,
  type SelectorStore,
  type SelectorUpsertInput,
} from './data/selectors/selectorRegistry';

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
  buildPageActionMetricAttributes,
  buildPageActionSpanAttributes,
  hashTelemetryValue,
  type PageActionMetricStatus,
  type PageActionMetricInput,
  type PageActionTelemetryInput,
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
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  resolveSelfHealingConfig,
} from './framework/selfHealing/config';

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
  GuardedAutoHealSkipReason,
  GuardedAutoHealSummary,
  GuardedValidationCandidate,
  GuardedValidationPolicyBlockReason,
  GuardedValidationPolicyDecision,
  GuardedValidationStatus,
  GuardedValidationSummary,
  SelfHealingActionContext,
  SelfHealingActionType,
  SelfHealingConfig,
  SelfHealingMode,
  SelfHealingSafetyPolicy,
  SelfHealingSuggestion,
  SelfHealingSuggestionSignals,
  SelfHealingSuggestionStrategy,
} from './framework/selfHealing/types';
