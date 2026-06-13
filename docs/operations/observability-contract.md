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

## Prometheus Export Contract

The OpenTelemetry Collector Prometheus exporter normalizes dotted attributes into underscore labels. Dashboards and alert rules must use labels proven by `npm run observability:live-assert`, which writes `observability-label-snapshot.json` from real `/api/v1/labels`, `/api/v1/series`, `/api/v1/query`, and `/api/v1/rules` responses.

Primary normalized labels:

- `auroraflow_test_status`, `auroraflow_project`, `auroraflow_shard`
- `auroraflow_page_object`, `auroraflow_action_type`, `auroraflow_action_status`
- `auroraflow_self_heal_mode`, `auroraflow_self_heal_status`, `auroraflow_self_heal_strategy`
- `auroraflow_redis_operation`, `auroraflow_redis_operation_status`
- `auroraflow_alert_severity`, `auroraflow_slo_metric`

Status values used by reference rules are `passed`/`failed` for tests, `failed` for guarded auto-heal failures, and `failed` for Redis operation failures. The older `status="failure"` matcher is not part of the emitted AuroraFlow metric contract.

Histogram metric names use the Collector's Prometheus unit suffix. For example, `auroraflow_page_action_duration_ms` is queried as `auroraflow_page_action_duration_ms_milliseconds_bucket` in p95 PromQL.

## Privacy Rules

Raw selectors, URLs, request bodies, passwords, tokens, and cookies must not be emitted by default. Action spans use `auroraflow.action.target_hash` plus `auroraflow.action.target_kind`; the raw target is present only when `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true`.

## Export validation tiers

- Routine verification uses a process-local OTLP/HTTP protobuf receiver. It exercises the real trace and metric exporters and asserts representative span names, metric names, attributes, and resource metadata without starting the reference stack.
- The collector-only smoke remains path-filtered for observability changes and `main` runs.
- Full-stack and secret-gated remote-export smokes are scheduled or manually dispatched. They are intentionally excluded from pull-request execution because their service startup cost is disproportionate to the focused export contract.
- Artifact-only/no-op behavior remains the supported default; these tests do not create a production observability support claim.
