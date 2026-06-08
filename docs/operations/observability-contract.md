# Observability Contract

AuroraFlow telemetry is opt-in. The framework must not export live telemetry unless `AURORAFLOW_OBSERVABILITY_ENABLED=true` is set. When disabled, the telemetry facade stays no-op and the JSON/Markdown artifact pipeline remains authoritative.

## Environment Variables

- `AURORAFLOW_OBSERVABILITY_ENABLED`: enables the OpenTelemetry-backed adapter when set to a true-like value.
- `AURORAFLOW_OBSERVABILITY_STRICT`: fails initialization or shutdown on telemetry errors when true.
- `AURORAFLOW_OBSERVABILITY_SERVICE_NAME`: overrides `service.name`; default is `auroraflow`.
- `AURORAFLOW_OBSERVABILITY_SERVICE_VERSION`: overrides `service.version`; default follows the package version.
- `AURORAFLOW_OBSERVABILITY_ENVIRONMENT`: one of `local`, `ci`, `staging`, or `production`.
- `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS`: allows raw action targets in spans only when explicitly enabled.
- `AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS`: metric export interval.
- `AURORAFLOW_OBSERVABILITY_SHUTDOWN_TIMEOUT_MS`: bounded flush/shutdown timeout.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: standard OTLP endpoint used by OpenTelemetry exporters.
- `OTEL_SERVICE_NAME`: standard fallback for `service.name`.
- `OTEL_RESOURCE_ATTRIBUTES`: standard comma-separated resource attributes.

## Resource Attributes

Every emitted signal should carry these attributes when the value is known:

- `service.name`
- `service.version`
- `deployment.environment`
- `vcs.repository.url`
- `vcs.branch`
- `vcs.commit.sha`
- `ci.workflow.name`
- `ci.job.name`
- `ci.run.id`
- `auroraflow.run_id`
- `auroraflow.test_id`
- `auroraflow.project`
- `auroraflow.shard`

## Span Names

- `auroraflow.test_run`
- `auroraflow.test_case`
- `auroraflow.page_action`
- `auroraflow.redis.operation`
- `auroraflow.self_healing.capture`
- `auroraflow.self_healing.suggestion_rank`
- `auroraflow.self_healing.guarded_validation`
- `auroraflow.self_healing.auto_apply`
- `auroraflow.report.flakiness`
- `auroraflow.report.slo_dashboard`
- `auroraflow.report.slo_alerts`

## Metric Names

- `auroraflow_test_runs_total`
- `auroraflow_test_cases_total`
- `auroraflow_test_attempts_total`
- `auroraflow_test_case_duration_ms`
- `auroraflow_page_actions_total`
- `auroraflow_page_action_duration_ms`
- `auroraflow_page_action_failures_total`
- `auroraflow_flaky_tests_total`
- `auroraflow_retry_failures_total`
- `auroraflow_slo_metric_value`
- `auroraflow_slo_alert_breaches_total`
- `auroraflow_self_healing_artifacts_total`
- `auroraflow_self_healing_suggestions_total`
- `auroraflow_guarded_validation_candidates_total`
- `auroraflow_guarded_auto_heal_total`
- `auroraflow_self_healing_registry_writes_total`
- `auroraflow_redis_operations_total`
- `auroraflow_redis_operation_duration_ms`
- `auroraflow_redis_operation_retries_total`

## Privacy Rules

Raw selectors, URLs, request bodies, passwords, tokens, and cookies must not be emitted by default. Action spans use `auroraflow.action.target_hash` plus `auroraflow.action.target_kind`; the raw target is present only when `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true`.
