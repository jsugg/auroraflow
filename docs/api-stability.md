# API stability

AuroraFlow is published as a public npm library (`AUR-DEC-001`). Every export of the package root (`import { ... } from 'auroraflow'`) is classified into a stability tier, and the classification below is machine-readable: the package-surface contract test parses `src/index.ts` and the tables in this document and fails when any root export is unclassified, stale, or mislabeled. Repository-internal source paths are not part of the package contract.

## Stability tiers

| Tier | Compatibility guarantee |
| --- | --- |
| stable | Core supported API. Breaking changes only in a major release, after a deprecation period covering at least one minor release and 90 days. |
| advanced | Supported integration surface for power users (stores, telemetry wiring, governance tooling, artifact contracts). Breaking changes only in a major release; the deprecation period may be as short as one minor release. |
| experimental | May change or be reshaped in a minor release. Changes are called out in the changelog with an `experimental` label. Not covered by the semver compatibility guarantee. |
| deprecated | Scheduled for removal. Keeps working until the documented removal horizon; removal happens only in a major release. |
| internal | Exported only for framework wiring or test isolation. No compatibility guarantee; may change or disappear in any release. Do not depend on these. |

Tier changes themselves follow the same rules: moving an export to a weaker tier (for example stable to deprecated) is announced in the changelog and takes effect in the next minor release at the earliest; moving to a stronger tier can happen in any release.

## Deprecation policy

1. A deprecation is announced in the changelog under a `deprecated` label, the export's row in this document moves to the `deprecated` tier, and the declaration gains a `@deprecated` JSDoc tag naming the replacement when one exists.
2. A deprecated stable export keeps working for at least one minor release and at least 90 days after the announcement. A deprecated advanced export keeps working for at least one minor release.
3. Removal or renaming happens only in a major release. The changelog entry for that release lists every removed export and its replacement.
4. Experimental and internal exports may be removed without a deprecation period; experimental removals are still listed in the changelog.

No export is deprecated today, so the `deprecated` tier is currently empty.

## Compatibility surfaces beyond the root exports

Machine-readable surfaces that consumers and dashboards depend on are versioned and governed alongside the code:

- **Artifact schemas** (`schemas/*.json`, shipped in the npm package): self-healing failure events, DOM snapshots, candidate histories, pending promotions, flakiness summaries, SLO dashboards, alert evaluations, and observability trend points carry explicit `schemaVersion`/`artifactVersion` fields. Schema changes follow the same semver discipline as `advanced` exports and are validated by `npm run schemas:check`. See [Artifact schemas](./operations/artifact-schemas.md).
- **Metric names** (`METRIC_NAMES`, `REQUIRED_METRIC_NAMES`): Prometheus series names and their required attribute conventions are a stable contract because rules and dashboards under `observability/` reference them by name. Renaming a metric is a breaking change.
- **CLI scripts** (`npm run self-heal:promotions`, `self-heal:governance`, `self-heal:cleanup`, `flakiness:report`, `slo:dashboard`, `slo:alerts`): repository scripts are not shipped in the npm package; their flags and output follow the `advanced` tier rules for consumers that invoke them from a repository checkout.
- **Environment configuration** (`SELF_HEAL_*`, `AURORAFLOW_*`, `REDIS_*`, `LOG_*` variables documented in [Configuration](./configuration.md)): resolved configuration defaults and clamps follow the tier of the function that reads them; `resolveSelfHealingConfig()` and its diagnostics contract are stable.

## Root export classification

Every root export appears in exactly one row below. `Kind` distinguishes runtime values from type-only exports. The package-surface contract test enforces that this inventory and `src/index.ts` stay identical.

The self-healing engine rows are experimental because candidate scoring calibration (`AUR-IMPL-020`) and the page-action pipeline restructuring (`AUR-IMPL-022`) are expected to reshape those signatures; depend on the artifact contracts instead where possible.

### Page objects, factory, and helpers

| Export                  | Kind    | Tier   |
| ----------------------- | ------- | ------ |
| `PageActionError`       | runtime | stable |
| `PageActionInputError`  | runtime | stable |
| `PageObjectBase`        | runtime | stable |
| `ActionContext`         | type    | stable |
| `ActionOptions`         | type    | stable |
| `NavigationOptions`     | type    | stable |
| `PageFactory`           | runtime | stable |
| `PageObjectConstructor` | type    | stable |
| `retry`                 | runtime | stable |
| `wait`                  | runtime | stable |

### Logging

| Export                       | Kind    | Tier   |
| ---------------------------- | ------- | ------ |
| `LoggerConfigError`          | runtime | stable |
| `createChildLogger`          | runtime | stable |
| `createConfiguredLogger`     | runtime | stable |
| `getMainLogger`              | runtime | stable |
| `resolveLoggerRuntimeConfig` | runtime | stable |
| `setLogLevel`                | runtime | stable |
| `LogDestination`             | type    | stable |
| `Logger`                     | type    | stable |
| `LoggerRuntimeConfig`        | type    | stable |

### Self-healing configuration

| Export                                    | Kind    | Tier   |
| ----------------------------------------- | ------- | ------ |
| `DEFAULT_SELF_HEAL_MAX_CANDIDATES`        | runtime | stable |
| `DEFAULT_SELF_HEAL_MAX_DOM_NODES`         | runtime | stable |
| `DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH`       | runtime | stable |
| `DEFAULT_SELF_HEAL_MIN_CONFIDENCE`        | runtime | stable |
| `describeEffectiveSelfHealingConfig`      | runtime | stable |
| `resolveSelfHealingConfig`                | runtime | stable |
| `resolveSelfHealingConfigWithDiagnostics` | runtime | stable |
| `SELF_HEAL_CONFIG_STRICT_ENV`             | runtime | stable |
| `SelfHealingConfigError`                  | runtime | stable |
| `ResolveSelfHealingConfigOptions`         | type    | stable |
| `SelfHealingConfigDiagnostic`             | type    | stable |
| `SelfHealingConfigDiagnosticCode`         | type    | stable |
| `SelfHealingConfigResolution`             | type    | stable |

### Redis client and selector registry

| Export                                 | Kind    | Tier     |
| -------------------------------------- | ------- | -------- |
| `RedisClient`                          | runtime | advanced |
| `RedisConfigError`                     | runtime | advanced |
| `RedisConnectionError`                 | runtime | advanced |
| `RedisOperationError`                  | runtime | advanced |
| `getRedisClient`                       | runtime | advanced |
| `resetRedisClientForTests`             | runtime | internal |
| `resolveRedisRuntimeConfig`            | runtime | advanced |
| `RedisCompareAndSetOptions`            | type    | advanced |
| `RedisCompareAndSetResult`             | type    | advanced |
| `RedisClientDriver`                    | type    | advanced |
| `RedisRuntimeConfig`                   | type    | advanced |
| `RedisScanOptions`                     | type    | advanced |
| `RedisSetOptions`                      | type    | advanced |
| `DEFAULT_SELECTOR_REGISTRY_NAMESPACES` | runtime | advanced |
| `SelectorRegistryConflictError`        | runtime | advanced |
| `SelectorRegistryDataError`            | runtime | advanced |
| `SelectorRegistryRepository`           | runtime | advanced |
| `SelectorRegistryValidationError`      | runtime | advanced |
| `buildSelectorRegistryNamespaces`      | runtime | advanced |
| `SelectorRegistryNamespaces`           | type    | advanced |
| `SelectorRecord`                       | type    | advanced |
| `SelectorStore`                        | type    | advanced |
| `SelectorStoreCompareAndSetOptions`    | type    | advanced |
| `SelectorStoreCompareAndSetResult`     | type    | advanced |
| `SelectorStoreSetOptions`              | type    | advanced |
| `SelectorUpsertInput`                  | type    | advanced |
| `SelectorUpsertOptions`                | type    | advanced |
| `createRedisSelectorStore`             | runtime | advanced |
| `MemorySelectorStore`                  | runtime | advanced |
| `createMemorySelectorStore`            | runtime | advanced |
| `MemorySelectorStoreDurability`        | type    | advanced |
| `MemorySelectorStoreOptions`           | type    | advanced |
| `PendingSelectorPromotionQuery`        | type    | advanced |
| `PendingSelectorPromotionRepository`   | type    | advanced |
| `SelectorCandidateHistoryObservation`  | type    | advanced |
| `SelectorCandidateHistoryRepository`   | type    | advanced |
| `SelectorRegistryEntry`                | type    | advanced |
| `SelectorRegistryLookup`               | type    | advanced |
| `SelectorRegistryReader`               | type    | advanced |
| `SelfHealingRegistryRuntime`           | type    | advanced |

### Self-healing registry runtime and promotion governance

| Export                                           | Kind    | Tier         |
| ------------------------------------------------ | ------- | ------------ |
| `createRedisSelfHealingRegistryRuntime`          | runtime | advanced     |
| `createStoreSelfHealingRegistryRuntime`          | runtime | advanced     |
| `resolveSelfHealingRegistryRuntime`              | runtime | advanced     |
| `RedisSelfHealingRegistryRuntimeOptions`         | type    | advanced     |
| `ResolveSelfHealingRegistryRuntimeOptions`       | type    | advanced     |
| `StoreSelfHealingRegistryRuntimeOptions`         | type    | advanced     |
| `DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS` | runtime | advanced     |
| `MAX_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS`     | runtime | advanced     |
| `StoreSelectorCandidateHistoryRepository`        | runtime | advanced     |
| `StoreSelectorCandidateHistoryRepositoryOptions` | type    | advanced     |
| `StorePendingSelectorPromotionRepository`        | runtime | advanced     |
| `StorePendingSelectorPromotionRepositoryOptions` | type    | advanced     |
| `SelfHealingPromotionWorkflow`                   | runtime | advanced     |
| `ApprovePromotionInput`                          | type    | advanced     |
| `PromotionWorkflowListQuery`                     | type    | advanced     |
| `PromotionWorkflowListResult`                    | type    | advanced     |
| `PromotionWorkflowResult`                        | type    | advanced     |
| `RejectPromotionInput`                           | type    | advanced     |
| `RollbackPromotionInput`                         | type    | advanced     |
| `SelfHealingPromotionWorkflowOptions`            | type    | advanced     |
| `DEFAULT_PENDING_SELECTOR_PROMOTION_TTL_SECONDS` | runtime | advanced     |
| `persistSelfHealingRegistryTelemetry`            | runtime | experimental |
| `PersistSelfHealingRegistryTelemetryInput`       | type    | experimental |

### Self-healing engine

| Export                              | Kind    | Tier         |
| ----------------------------------- | ------- | ------------ |
| `analyzeSelfHealingFailure`         | runtime | experimental |
| `SelfHealingAnalysisResult`         | type    | experimental |
| `SelfHealingFailureContext`         | type    | experimental |
| `buildSelfHealingCandidateId`       | runtime | experimental |
| `rankSelfHealingCandidates`         | runtime | experimental |
| `CandidateScoringInput`             | type    | experimental |
| `SelfHealingCandidateSeed`          | type    | experimental |
| `extractDomCandidateSeeds`          | runtime | experimental |
| `DomCandidateExtractionInput`       | type    | experimental |
| `captureDomSnapshot`                | runtime | experimental |
| `normalizeAllowedAttributes`        | runtime | experimental |
| `normalizeDomText`                  | runtime | experimental |
| `redactDomAttributeValue`           | runtime | experimental |
| `summarizeDomSnapshot`              | runtime | experimental |
| `DomSnapshotOptions`                | type    | experimental |
| `DEFAULT_ARTIFACT_PRIVACY_POLICY`   | runtime | experimental |
| `SENSITIVE_ARTIFACT_PRIVACY_POLICY` | runtime | experimental |
| `applyDomSnapshotPrivacy`           | runtime | experimental |
| `captureFailureScreenshot`          | runtime | experimental |
| `resolveArtifactPrivacyPolicy`      | runtime | experimental |
| `ArtifactPrivacyPolicy`             | type    | experimental |
| `ArtifactPrivacyPreset`             | type    | experimental |
| `captureFailureEvent`               | runtime | experimental |
| `createFileFailureArtifactWriter`   | runtime | experimental |
| `CaptureFailureEventInput`          | type    | experimental |
| `FailureArtifactWriter`             | type    | experimental |
| `generateRankedLocatorSuggestions`  | runtime | experimental |
| `SuggestionEngineInput`             | type    | experimental |
| `evaluateGuardedSuggestionsDryRun`  | runtime | experimental |
| `resolveLocatorExpression`          | runtime | experimental |
| `GuardedValidationInput`            | type    | experimental |

### Self-healing artifact contracts

| Export                                  | Kind    | Tier     |
| --------------------------------------- | ------- | -------- |
| `SelfHealingArtifactSchemaError`        | runtime | advanced |
| `parseCapturedFailureEvent`             | runtime | advanced |
| `parseDomSnapshot`                      | runtime | advanced |
| `parsePendingSelectorPromotion`         | runtime | advanced |
| `parseSelectorCandidateHistory`         | runtime | advanced |
| `CapturedFailureError`                  | type    | advanced |
| `CapturedFailureEvent`                  | type    | advanced |
| `CandidateEvidence`                     | type    | advanced |
| `DomElementSummary`                     | type    | advanced |
| `DomSnapshot`                           | type    | advanced |
| `DomSnapshotSummary`                    | type    | advanced |
| `GuardedAutoHealSkipReason`             | type    | advanced |
| `GuardedAutoHealSummary`                | type    | advanced |
| `GuardedValidationCandidate`            | type    | advanced |
| `GuardedValidationPolicyBlockReason`    | type    | advanced |
| `GuardedValidationPolicyDecision`       | type    | advanced |
| `GuardedValidationStatus`               | type    | advanced |
| `GuardedValidationSummary`              | type    | advanced |
| `PendingSelectorPromotion`              | type    | advanced |
| `PendingSelectorPromotionStatus`        | type    | advanced |
| `PendingSelectorPromotionWriteResult`   | type    | advanced |
| `RankedSelfHealingCandidate`            | type    | advanced |
| `SelectorCandidateHistory`              | type    | advanced |
| `SelectorCandidateHistoryWriteResult`   | type    | advanced |
| `SelectorCandidateHistorySummary`       | type    | advanced |
| `SelfHealingActionContext`              | type    | advanced |
| `SelfHealingActionType`                 | type    | advanced |
| `SelfHealingConfig`                     | type    | stable   |
| `SelfHealingMode`                       | type    | stable   |
| `SelfHealingPromotionMode`              | type    | stable   |
| `SelfHealingRegistryPersistenceSummary` | type    | advanced |
| `SelfHealingRegistryMode`               | type    | stable   |
| `SelfHealingRegistryWriteStatus`        | type    | advanced |
| `SelfHealingSafetyPolicy`               | type    | stable   |
| `SelfHealingSatAnalysis`                | type    | advanced |
| `SelfHealingSatConfig`                  | type    | stable   |
| `SelfHealingSuggestion`                 | type    | advanced |
| `SelfHealingSuggestionSignals`          | type    | advanced |
| `SelfHealingSuggestionStrategy`         | type    | advanced |

### Telemetry and metric names

| Export                                          | Kind    | Tier     |
| ----------------------------------------------- | ------- | -------- |
| `normalizeOptionalIdentifier`                   | runtime | advanced |
| `resolveCorrelationIdentifiers`                 | runtime | advanced |
| `resolveRunId`                                  | runtime | advanced |
| `resolveTestId`                                 | runtime | advanced |
| `CorrelationIdentifiers`                        | type    | advanced |
| `CorrelationInput`                              | type    | advanced |
| `SPAN_NAMES`                                    | runtime | advanced |
| `buildGuardedAutoHealMetricAttributes`          | runtime | advanced |
| `buildGuardedValidationMetricAttributes`        | runtime | advanced |
| `buildGuardedValidationSpanAttributes`          | runtime | advanced |
| `buildPageActionMetricAttributes`               | runtime | advanced |
| `buildPageActionSpanAttributes`                 | runtime | advanced |
| `buildRedisOperationMetricAttributes`           | runtime | advanced |
| `buildRedisOperationSpanAttributes`             | runtime | advanced |
| `buildSelfHealingArtifactMetricAttributes`      | runtime | advanced |
| `buildSelfHealingCaptureSpanAttributes`         | runtime | advanced |
| `buildSelfHealingRegistryWriteMetricAttributes` | runtime | advanced |
| `buildSelfHealingSuggestionMetricAttributes`    | runtime | advanced |
| `hashTelemetryValue`                            | runtime | advanced |
| `GuardedAutoHealMetricInput`                    | type    | advanced |
| `GuardedAutoHealMetricStatus`                   | type    | advanced |
| `GuardedValidationMetricInput`                  | type    | advanced |
| `GuardedValidationMetricStatus`                 | type    | advanced |
| `GuardedValidationTelemetryInput`               | type    | advanced |
| `PageActionMetricStatus`                        | type    | advanced |
| `PageActionMetricInput`                         | type    | advanced |
| `PageActionTelemetryInput`                      | type    | advanced |
| `RedisOperationStatus`                          | type    | advanced |
| `RedisOperationTelemetryInput`                  | type    | advanced |
| `SelfHealingArtifactMetricInput`                | type    | advanced |
| `SelfHealingCaptureTelemetryInput`              | type    | advanced |
| `SelfHealingRegistryWriteMetricInput`           | type    | advanced |
| `SelfHealingRegistryWriteMetricStatus`          | type    | advanced |
| `SelfHealingRegistryWriteOperation`             | type    | advanced |
| `SelfHealingSuggestionMetricInput`              | type    | advanced |
| `METRIC_NAMES`                                  | runtime | stable   |
| `REQUIRED_METRIC_NAMES`                         | runtime | stable   |
| `MetricName`                                    | type    | stable   |
| `initializeTelemetry`                           | runtime | advanced |
| `getTelemetry`                                  | runtime | advanced |
| `shutdownTelemetry`                             | runtime | advanced |
| `AuroraFlowTelemetry`                           | type    | advanced |
| `TelemetryAttributes`                           | type    | advanced |
| `TelemetryAttributeValue`                       | type    | advanced |
| `TelemetryDiagnosticLogger`                     | type    | advanced |
| `TelemetryLogCorrelation`                       | type    | advanced |
| `TelemetryOperationOptions`                     | type    | advanced |
| `TelemetrySpan`                                 | type    | advanced |
| `TelemetrySpanStatus`                           | type    | advanced |
| `TelemetryConfigError`                          | runtime | advanced |
| `RESOURCE_ATTRIBUTE_NAMES`                      | runtime | advanced |
| `resolveTelemetryConfig`                        | runtime | advanced |
| `ObservabilityEnvironment`                      | type    | advanced |
| `ResourceAttributeName`                         | type    | advanced |
| `TelemetryRuntimeConfig`                        | type    | advanced |

### Reports, dashboards, alerts, and trends

| Export                                             | Kind    | Tier     |
| -------------------------------------------------- | ------- | -------- |
| `PLAYWRIGHT_REPORT_FILE_PREFIX`                    | runtime | advanced |
| `buildFlakinessMarkdown`                           | runtime | advanced |
| `buildFlakinessSummary`                            | runtime | advanced |
| `extractFlakinessCasesFromReport`                  | runtime | advanced |
| `parseFlakinessReportFile`                         | runtime | advanced |
| `FinalTestStatus`                                  | type    | advanced |
| `FlakinessSummary`                                 | type    | advanced |
| `FlakinessTestCase`                                | type    | advanced |
| `ProjectFlakinessSummary`                          | type    | advanced |
| `buildSloDashboard`                                | runtime | advanced |
| `buildSloDashboardMarkdown`                        | runtime | advanced |
| `SelfHealingGovernanceSummary`                     | type    | advanced |
| `SloDashboard`                                     | type    | advanced |
| `SloMetric`                                        | type    | advanced |
| `SloMetricComparator`                              | type    | advanced |
| `SloMetricKey`                                     | type    | advanced |
| `SloMetricStatus`                                  | type    | advanced |
| `SloMetricTarget`                                  | type    | advanced |
| `AlertPolicyValidationError`                       | runtime | advanced |
| `buildAlertEvaluationMarkdown`                     | runtime | advanced |
| `evaluateAlertPolicy`                              | runtime | advanced |
| `parseAlertPolicy`                                 | runtime | advanced |
| `AlertBreach`                                      | type    | advanced |
| `AlertEvaluationResult`                            | type    | advanced |
| `AlertOperator`                                    | type    | advanced |
| `AlertPolicy`                                      | type    | advanced |
| `AlertRule`                                        | type    | advanced |
| `AlertSeverity`                                    | type    | advanced |
| `DEFAULT_OBSERVABILITY_TREND_LIMIT`                | runtime | advanced |
| `MAX_OBSERVABILITY_TREND_LIMIT`                    | runtime | advanced |
| `OBSERVABILITY_TREND_SCHEMA_VERSION`               | runtime | advanced |
| `ObservabilityTrendPersistenceError`               | runtime | advanced |
| `appendObservabilityTrendPoint`                    | runtime | advanced |
| `buildObservabilityTrendPointFromFlakinessSummary` | runtime | advanced |
| `buildObservabilityTrendPointFromSloDashboard`     | runtime | advanced |
| `parseObservabilityTrendPoint`                     | runtime | advanced |
| `readObservabilityTrendPoints`                     | runtime | advanced |
| `resolveTrendLimit`                                | runtime | advanced |
| `resolveTrendOutputPath`                           | runtime | advanced |
| `ObservabilityTrendGovernance`                     | type    | advanced |
| `ObservabilityTrendGuardedAutoHeal`                | type    | advanced |
| `ObservabilityTrendPoint`                          | type    | advanced |
| `ObservabilityTrendRates`                          | type    | advanced |
| `ObservabilityTrendSlo`                            | type    | advanced |
| `ObservabilityTrendSource`                         | type    | advanced |
| `ObservabilityTrendTotals`                         | type    | advanced |
| `ObservabilityTrendWriteResult`                    | type    | advanced |
