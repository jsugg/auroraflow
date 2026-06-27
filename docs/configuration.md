# Configuration

AuroraFlow reads configuration from explicit function inputs, CLI flags, and environment variables. Environment variables are parsed with bounded validation at the boundary.

## Runtime modes

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `SELF_HEAL_MODE` | `off`, `suggest`, `guarded` | `off` | Enables self-healing capture and guarded validation. |
| `SELF_HEAL_MIN_CONFIDENCE` | `0..1` | `0.92` | Safety floor for guarded candidate acceptance. |
| `SELF_HEAL_ALLOWED_ACTIONS` | comma-separated action types | `click,type,read,wait,screenshot` | Action types eligible for guarded validation. |
| `SELF_HEAL_ALLOWED_DOMAINS` | comma-separated hosts | empty | Optional host allow-list for guarded validation. |
| `AURORAFLOW_CONFIG_STRICT` | boolean-like | `false` | Opt-in strict mode: invalid `SELF_HEAL_*` values throw `SelfHealingConfigError` instead of warning. |

Invalid `SELF_HEAL_*` values are observable instead of silently defaulting: `resolveSelfHealingConfig()` logs one warning per invalid value with the applied fallback, and throws when `AURORAFLOW_CONFIG_STRICT=true`. `resolveSelfHealingConfigWithDiagnostics()` returns `{ config, diagnostics, strict }` without logging or throwing for callers that report diagnostics themselves. Diagnostic messages name the variable, the expected format, and the applied value, but never echo the received value, so they cannot leak secrets accidentally placed in these variables. `describeEffectiveSelfHealingConfig(config)` returns a JSON-safe snapshot of the effective configuration for logging; it only contains values derived from `SELF_HEAL_*` variables, never credentials such as Redis settings.

## SAT and registry

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `SELF_HEAL_SAT_ENABLED` | boolean-like | enabled when mode is `suggest` or `guarded` | Enables SAT enrichment. |
| `SELF_HEAL_SAT_CAPTURE_DOM` | boolean-like | enabled with SAT | Captures bounded DOM summaries. |
| `SELF_HEAL_MAX_DOM_NODES` | `1..5000` | `500` | Max DOM nodes captured. |
| `SELF_HEAL_MAX_CANDIDATES` | `1..50` | `10` | Max ranked candidates evaluated. |
| `SELF_HEAL_MAX_TEXT_LENGTH` | `1..500` | `120` | Max normalized text length per DOM element. |
| `SELF_HEAL_ALLOWED_ATTRIBUTES` | comma-separated attribute names | `data-testid,data-test,id,name,aria-label,placeholder,title,role,type` | DOM attributes retained for candidate extraction. |
| `SELF_HEAL_REGISTRY_MODE` | `off`, `read`, `write_pending` | `read` | Reads active selectors/history or writes reviewable pending records. |
| `SELF_HEAL_REGISTRY_REQUIRED` | boolean-like | `false` | Fails registry resolution when Redis is required but unavailable. |
| `SELF_HEAL_REGISTRY_NAMESPACE` | string | `selector-registry` | Active selector namespace. |
| `SELF_HEAL_PROMOTION_MODE` | `manual`, `ci_acknowledged` | `manual` | SAT promotion-write posture exposed as `sat.promotionMode`; reviewed mutation authorization is controlled by the promotion CLI/workflow policy below. |

Read mode is opportunistic unless Redis configuration is present or `SELF_HEAL_REGISTRY_REQUIRED=true`. Write-pending mode records SAT history and pending promotions when a registry runtime is configured.

Default guarded healing is registry-curated by policy: fresh heuristic and DOM candidates are diagnostic below the `0.92` floor, while curated registry entries at or above the floor and strongly validated candidate history can pass guarded dry-run validation. Lower thresholds require reachability tests and an updated decision record.

Candidate-history retention follows `AUR-DEC-005`: the exported default and hard cap are both `2,592,000` seconds (30 days). Positive custom TTLs below the cap are honored; higher values are clamped to 30 days. Redis history data is consumer-owned.

## Run-level self-healing budget

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `SELF_HEAL_RUN_BUDGET_MODE` | `warning_only`, `enforce` | `warning_only` | Warning-only mode counts failures and emits one warning when a run exceeds either budget. `enforce` downgrades after the configured max. |
| `SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS` | `0..10000` | `25` | Max per-run failures eligible for screenshots, SAT/DOM analysis, guarded validation, guarded auto-apply, and registry writes. |
| `SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS` | `0..10000` | `50` | Max per-run failure artifacts. A value above the healing-attempt budget allows capture-only artifacts after full healing is exhausted. |

`AUR-DEC-013` keeps the default warning-only until a failure-path baseline exists. In `enforce` mode, AuroraFlow first downgrades exhausted healing work to capture-only artifacts with no SAT, guarded probe, auto-apply, or registry write. After the artifact budget is exhausted, it records no self-healing artifact for the remaining storm and surfaces the original page-action failure. Budget downgrades never mutate selector records or source selectors.

## Artifact privacy

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `AURORAFLOW_ARTIFACT_PRIVACY_PRESET` | `compatible`, `sensitive` | `compatible` | Keeps current failure screenshot/DOM text capture, or disables screenshots and omits visible DOM text before candidate extraction. |

Invalid values use `compatible` and emit a diagnostic without echoing the received value. Custom screenshot masks and DOM text redact/hash/disable policies are available through the experimental `ArtifactPrivacyPolicy` API and the protected `PageObjectBase` resolver seam. See [Artifact privacy and retention](./operations/privacy-retention.md). These controls target synthetic and non-production PII; they are not regulated-PII support.

## Redis

| Variable | Default | Notes |
| --- | --- | --- |
| `AURORAFLOW_REDIS_URL` | unset | Full `redis://` or `rediss://` URL. |
| `AURORAFLOW_REDIS_HOST` | `127.0.0.1` | Ignored by Redis client options when URL is supplied. |
| `AURORAFLOW_REDIS_PORT` | `6379` | Integer TCP port. |
| `AURORAFLOW_REDIS_DB` | `0` | Redis database index. |
| `AURORAFLOW_REDIS_USERNAME` | unset | Optional ACL username. |
| `AURORAFLOW_REDIS_PASSWORD` | unset | Optional password. |
| `AURORAFLOW_REDIS_TLS` | `false` | Enables TLS. |
| `AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS` | `5000` | Connection timeout. |
| `AURORAFLOW_REDIS_MAX_RETRIES` | `3` | Operation retries. |
| `AURORAFLOW_REDIS_BASE_BACKOFF_MS` | `50` | Retry base delay. |
| `AURORAFLOW_REDIS_MAX_BACKOFF_MS` | `2000` | Retry cap; must be at least base delay. |
| `AURORAFLOW_REDIS_KEY_PREFIX` | `auroraflow` | Key namespace prefix. |

Redis keys are namespaced and selector updates use versioned compare-and-set for reviewed promotion workflows. Promotion status transitions use expected-status compare-and-set, so concurrent approve/reject/rollback races become explicit conflicts instead of last-writer-wins updates. Selector-candidate history writes use backend-side atomic JSON merges for counters and 30-day capped TTL refreshes; they do not rely on process-local locks.

Production Redis deployments are consumer/operator-owned. Configure TLS, authentication, ACLs, backups, restore drills, no-eviction capacity headroom, retention, and incident response outside AuroraFlow; key prefixes are namespace hygiene, not authorization. See the [Redis production runbook](./operations/redis-production-runbook.md).

## Self-healing governance

| Variable | Default | Purpose |
| --- | --- | --- |
| `SELF_HEAL_ARTIFACTS_DIR` | `test-results/self-healing` | Self-healing artifact output directory and governance input directory. |
| `SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED` | `true` | Fails governance when guarded accepted candidates need review. |
| `SELF_HEAL_ACKNOWLEDGED` | `false` | Acknowledges accepted candidates after review. |
| `SELF_HEAL_GOVERNANCE_SUMMARY_JSON` | `test-results/self-healing-governance-summary.json` | JSON summary path. |
| `SELF_HEAL_GOVERNANCE_SUMMARY_MD` | `test-results/self-healing-governance-summary.md` | Markdown summary path. |
| `SELF_HEAL_PROMOTION_AUTHORIZATION_MODE` | `local` | Promotion CLI authorization mode. `local` permits mutations and warns; `shared` requires CODEOWNERS plus protected workflow evidence. |
| `SELF_HEAL_PROMOTION_CODEOWNERS_PATH` | `.github/CODEOWNERS` | CODEOWNERS file used by shared promotion authorization. |
| `SELF_HEAL_PROMOTION_PROTECTED_WORKFLOW` | `GITHUB_REF_PROTECTED` fallback, otherwise `false` | Explicit protected-workflow evidence for shared promotion authorization. |
| `SELF_HEAL_REGISTRY_CLEANUP_LIMIT` | `1000` | Max records scanned by cleanup. |
| `SELF_HEAL_REGISTRY_REPAIR_LIMIT` | `1000` | Max active records and index keys scanned per repair pass (`1..100000`). |
| `SELF_HEAL_REGISTRY_REPAIR_APPLY` | `false` | Apply schema/index repairs; default repair behavior is dry-run. |
| `SELF_HEAL_REGISTRY_CLEANUP_APPLY` | `false` | Cleanup is dry-run by default; set `true` to delete expired history, promotion, and audit records. |
| `SELF_HEAL_AUDIT_RETENTION_SECONDS` | `2592000` | Audit cleanup retention window for records without an explicit `expiresAt`; values above 30 days are clamped. |

In this repository, use `npm run self-heal:governance`, `npm run self-heal:promotions`, `npm run self-heal:cleanup`, and `npm run self-heal:repair` for review and maintenance workflows. Cleanup and repair report dry-run summaries by default. Repair applies only with `--apply` or `SELF_HEAL_REGISTRY_REPAIR_APPLY=true`; cleanup uses its corresponding apply controls. External projects can call the exported workflow/repository APIs or own equivalent scripts.

## Observability

| Variable | Values/default | Purpose |
| --- | --- | --- |
| `AURORAFLOW_OBSERVABILITY_ENABLED` | `false` | Enables OpenTelemetry-backed telemetry. |
| `AURORAFLOW_OBSERVABILITY_STRICT` | `false` | Fails on telemetry init/shutdown errors. |
| `AURORAFLOW_OBSERVABILITY_SERVICE_NAME` | `auroraflow` | Service name resource attribute. |
| `AURORAFLOW_OBSERVABILITY_SERVICE_VERSION` | package version | Service version resource attribute. |
| `AURORAFLOW_OBSERVABILITY_ENVIRONMENT` | `local`, `ci`, `staging`, `production` | Deployment environment. |
| `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS` | `false` | Allows raw selectors in spans for local debugging only. |
| `AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS` | `10000` | Metric export interval. |
| `AURORAFLOW_OBSERVABILITY_SHUTDOWN_TIMEOUT_MS` | `3000` | Bounded telemetry shutdown. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP HTTP endpoint. |
| `OTEL_SERVICE_NAME` | unset | Standard fallback service name. |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | Standard resource attributes. |

Snapshot, backend-validator, and live assertion scripts also accept URL/path flags for Prometheus, Grafana, Jaeger, Kibana, Elasticsearch, dashboards, rules, and output directories. `npm run observability:validate` additionally accepts `--mode readiness|smoke`, `--max-attempts`, and `--poll-interval-ms`; it writes typed JSON diagnostics. See [Observability contract](./operations/observability-contract.md).

Artifact-only/no-op is the supported default. The collector-only Lite tier is opt-in and best effort; the Full stack is local/reference only. Starting either topology does not set `AURORAFLOW_OBSERVABILITY_ENABLED`. See [Observability support tiers](./operations/observability-support-tiers.md).

## Logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `AURORAFLOW_LOG_LEVEL` / `LOG_LEVEL` | `info` | Pino log level. |
| `AURORAFLOW_LOG_DESTINATION` | `both` locally, `file` in production | `both`, `console`, `file`, or `silent`. |
| `AURORAFLOW_LOG_FILE_PATH` | `./logs/test-runs.log` | File destination path. |
| `AURORAFLOW_LOG_REDACT_ENABLED` | `true` | Enables redaction. |
| `AURORAFLOW_LOG_REDACT_PATHS` | built-in secret-shaped paths | Comma-separated Pino redaction paths. |
| `AURORAFLOW_LOG_REDACT_CENSOR` | `[Redacted]` | Replacement value. |

Logger configuration is resolved on first default logger use. Importing `auroraflow` or its logger module does not validate logger environment values or create Pino transports. `getMainLogger()`, `createChildLogger()`, and `setLogLevel()` retain their existing API and initialize the shared logger only when called.

## Trends

| Variable                  | Default                     | Purpose                    |
| ------------------------- | --------------------------- | -------------------------- |
| `AURORAFLOW_TREND_OUTPUT` | unset                       | JSONL trend output path.   |
| `AURORAFLOW_TREND_LIMIT`  | `100`                       | Max retained trend points. |
| `AURORAFLOW_BRANCH`       | GitHub env/local fallback   | Trend branch metadata.     |
| `AURORAFLOW_COMMIT`       | GitHub env/local fallback   | Trend commit metadata.     |
| `AURORAFLOW_WORKFLOW`     | GitHub env/local fallback   | Trend workflow metadata.   |
| `AURORAFLOW_PROJECT`      | package name/local fallback | Trend project metadata.    |

CLI flags such as `--trend-output` and `--trend-limit` override environment fallbacks.

Durable copies are optional and consumer/operator-owned. AuroraFlow configures no destination or upload credentials; see [Durable trend export](./operations/trend-durable-export.md).

## Package contents

The npm package intentionally includes:

- `dist/`
- `docs/`
- `schemas/`
- `README.md`
- `LICENSE`

Examples, tests, workflow files, scripts, and observability stack assets remain repository tooling unless explicitly exported later.
