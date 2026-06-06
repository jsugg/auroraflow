export const METRIC_NAMES = Object.freeze({
  testRunsTotal: 'auroraflow_test_runs_total',
  testCasesTotal: 'auroraflow_test_cases_total',
  testAttemptsTotal: 'auroraflow_test_attempts_total',
  testCaseDurationMs: 'auroraflow_test_case_duration_ms',
  pageActionsTotal: 'auroraflow_page_actions_total',
  pageActionDurationMs: 'auroraflow_page_action_duration_ms',
  pageActionFailuresTotal: 'auroraflow_page_action_failures_total',
  flakyTestsTotal: 'auroraflow_flaky_tests_total',
  retryFailuresTotal: 'auroraflow_retry_failures_total',
  selfHealingArtifactsTotal: 'auroraflow_self_healing_artifacts_total',
  selfHealingSuggestionsTotal: 'auroraflow_self_healing_suggestions_total',
  guardedValidationCandidatesTotal: 'auroraflow_guarded_validation_candidates_total',
  guardedAutoHealTotal: 'auroraflow_guarded_auto_heal_total',
  redisOperationsTotal: 'auroraflow_redis_operations_total',
  redisOperationDurationMs: 'auroraflow_redis_operation_duration_ms',
  redisOperationRetriesTotal: 'auroraflow_redis_operation_retries_total',
} as const);

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

export const REQUIRED_METRIC_NAMES: readonly MetricName[] = Object.freeze([
  METRIC_NAMES.testRunsTotal,
  METRIC_NAMES.testCasesTotal,
  METRIC_NAMES.testAttemptsTotal,
  METRIC_NAMES.testCaseDurationMs,
  METRIC_NAMES.pageActionsTotal,
  METRIC_NAMES.pageActionDurationMs,
  METRIC_NAMES.pageActionFailuresTotal,
  METRIC_NAMES.flakyTestsTotal,
  METRIC_NAMES.retryFailuresTotal,
  METRIC_NAMES.selfHealingArtifactsTotal,
  METRIC_NAMES.selfHealingSuggestionsTotal,
  METRIC_NAMES.guardedValidationCandidatesTotal,
  METRIC_NAMES.guardedAutoHealTotal,
  METRIC_NAMES.redisOperationsTotal,
  METRIC_NAMES.redisOperationDurationMs,
  METRIC_NAMES.redisOperationRetriesTotal,
]);
