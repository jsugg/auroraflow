# Configuration

AuroraFlow reads configuration from explicit function inputs, CLI flags, and environment variables. Environment variables are parsed with bounded validation at the boundary.

## Runtime modes

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `SELF_HEAL_MODE` | `off`, `suggest`, `guarded` | `off` | Enables self-healing capture and guarded validation. |
| `SELF_HEAL_MIN_CONFIDENCE` | `0..1` | `0.92` | Safety floor for guarded candidate acceptance. |
| `SELF_HEAL_ALLOWED_ACTIONS` | comma-separated action types | `click,type,read,wait,screenshot` | Action types eligible for guarded validation. |
| `SELF_HEAL_ALLOWED_DOMAINS` | comma-separated hosts | empty | Optional host allow-list for guarded validation. |

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
| `SELF_HEAL_PROMOTION_MODE` | `manual`, `ci_acknowledged` | `manual` | Promotion workflow posture. |

Read mode is opportunistic unless Redis configuration is present or `SELF_HEAL_REGISTRY_REQUIRED=true`. Write-pending mode records SAT history and pending promotions when a registry runtime is configured.

Default guarded healing is registry-curated by policy: fresh heuristic and DOM candidates are diagnostic below the `0.92` floor, while curated registry entries at or above the floor and strongly validated candidate history can pass guarded dry-run validation. Lower thresholds require reachability tests and an updated decision record.

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

Redis keys are namespaced and selector updates use versioned compare-and-set for reviewed promotion workflows.

## Self-healing governance

| Variable | Default | Purpose |
| --- | --- | --- |
| `SELF_HEAL_ARTIFACTS_DIR` | `test-results/self-healing` | Input artifact directory. |
| `SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED` | `true` | Fails governance when guarded accepted candidates need review. |
| `SELF_HEAL_ACKNOWLEDGED` | `false` | Acknowledges accepted candidates after review. |
| `SELF_HEAL_GOVERNANCE_SUMMARY_JSON` | `test-results/self-healing-governance-summary.json` | JSON summary path. |
| `SELF_HEAL_GOVERNANCE_SUMMARY_MD` | `test-results/self-healing-governance-summary.md` | Markdown summary path. |
| `SELF_HEAL_REGISTRY_CLEANUP_LIMIT` | `1000` | Max records scanned by cleanup. |

In this repository, use `npm run self-heal:governance`, `npm run self-heal:promotions`, and `npm run self-heal:cleanup` for review and cleanup workflows. External projects can call the exported workflow/repository APIs or own equivalent scripts.

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

Snapshot and live assertion scripts also accept URL/path flags for Prometheus, Grafana, Jaeger, Kibana, Elasticsearch, dashboards, rules, and output directories. See [Observability contract](./operations/observability-contract.md).

## Logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `AURORAFLOW_LOG_LEVEL` / `LOG_LEVEL` | `info` | Pino log level. |
| `AURORAFLOW_LOG_DESTINATION` | `both` locally, `file` in production | `both`, `console`, `file`, or `silent`. |
| `AURORAFLOW_LOG_FILE_PATH` | `./logs/test-runs.log` | File destination path. |
| `AURORAFLOW_LOG_REDACT_ENABLED` | `true` | Enables redaction. |
| `AURORAFLOW_LOG_REDACT_PATHS` | built-in secret-shaped paths | Comma-separated Pino redaction paths. |
| `AURORAFLOW_LOG_REDACT_CENSOR` | `[Redacted]` | Replacement value. |

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

## Package contents

The npm package intentionally includes:

- `dist/`
- `docs/`
- `schemas/`
- `README.md`
- `LICENSE`

Examples, tests, workflow files, scripts, and observability stack assets remain repository tooling unless explicitly exported later.
