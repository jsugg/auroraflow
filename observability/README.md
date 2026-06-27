# AuroraFlow Observability Stack

This local stack extends the existing JSON and Markdown artifacts with live OpenTelemetry signals. Telemetry remains opt-in; package consumers get no live export unless they enable it explicitly.

## Support Tiers

- **Artifact-only** is the supported default and needs no services.
- **Lite** is best effort and starts only the OpenTelemetry Collector with `npm run observability:lite:up`.
- **Full** is local/reference only and uses the complete stack below.

See [`docs/operations/observability-support-tiers.md`](../docs/operations/observability-support-tiers.md) for ownership and validation boundaries. Starting either topology does not enable runtime telemetry automatically.

## Start

```bash
npm run observability:up
```

Open:

- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Jaeger: http://localhost:16686
- Kibana: http://localhost:5601
- OpenTelemetry Collector health: http://localhost:13133

## Emit Signals

```bash
AURORAFLOW_OBSERVABILITY_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm run test:smoke
```

`npm run observability:smoke` emits one synthetic trace, metric series, and JSON log after the stack is up.

To collect local backend API snapshots for troubleshooting or sharing as CI-style diagnostics:

```bash
npm run observability:snapshot
```

The command writes Prometheus, Grafana, Jaeger, Elasticsearch, and Kibana responses plus a `manifest.json` into `observability-output/snapshot`. Use `-- --allow-partial` to keep successful snapshots when one backend is unavailable.

To assert dashboards and alert rules against real Prometheus labels and status values:

```bash
npm run observability:live-assert
```

The command polls Prometheus metric series, validates dashboard/rule label references, and writes `observability-label-snapshot.json`.

## Files

- `docker-compose.observability.yml` starts the Collector, Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, and Kibana.
- `observability/otel-collector/config.yaml` receives OTLP over HTTP and gRPC, exposes Prometheus metrics on `9464`, and exports traces to Jaeger.
- `observability/prometheus/prometheus.yml` scrapes the Collector and loads local alert rules.
- `observability/grafana/provisioning` provisions Prometheus, Elasticsearch, Jaeger, and starter dashboards.
- `observability/logstash/pipeline/auroraflow.conf` reads structured logs and self-healing artifacts from local mounted paths.
- `observability/elastic/index-templates` and `observability/elastic/ilm` provide optional Elasticsearch templates and local retention policy definitions.
- `observability/kibana/saved-objects` provides importable data views for log and self-healing exploration.
- `observability/production` provides reference manifests for TLS/auth-enabled shared deployments.
- `scripts/observability-export-snapshot.ts` captures backend health and data-source snapshots into deterministic diagnostic files.
- `scripts/observability-live-export-assert.ts` verifies Prometheus label/series/query/rule semantics before dashboards or rules are trusted.

## Environment

- `AURORAFLOW_OBSERVABILITY_ENABLED=true` enables runtime telemetry.
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` sends telemetry to the local Collector.
- `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true` may include raw selectors for local debugging only. Keep it disabled for CI and shared environments.

## Logs

Logstash reads JSON lines from `logs/*.ndjson`, accepts local JSON smoke events on `http://localhost:8080`, and reads self-healing artifacts from `test-results/self-healing/*.json`. Secret-like field names and inline `key=value` fragments are redacted before indexing, and malformed JSON log lines are routed to `auroraflow-ingest-dead-letter-*` for triage.

To apply the optional local Elasticsearch retention policy and index templates:

```bash
curl -fsS -X PUT http://localhost:9200/_ilm/policy/auroraflow-local-retention \
  -H 'Content-Type: application/json' \
  --data-binary @observability/elastic/ilm/auroraflow-local-retention.json

for template in observability/elastic/index-templates/*.json; do
  name="$(basename "$template" .json)"
  curl -fsS -X PUT "http://localhost:9200/_index_template/$name" \
    -H 'Content-Type: application/json' \
    --data-binary "@$template"
done
```

To import Kibana data views:

```bash
curl -fsS -X POST http://localhost:5601/api/saved_objects/_import \
  -H 'kbn-xsrf: auroraflow' \
  --form file=@observability/kibana/saved-objects/auroraflow-log-exploration.ndjson
```

Shared environments need stronger upstream redaction, TLS, authentication, and retention policies before persistent indexing is enabled.

## CI Collector Smoke

Pull-request CI runs the best-effort Lite collector-only smoke lane for observability-related changes unless the repository variable `AURORAFLOW_OBSERVABILITY_CI_ENABLED` is set to `false`. The lane uses `docker-compose.observability-ci.yml` and `observability/otel-collector/ci-config.yaml`, emits one synthetic trace/metric/log event, and uploads collector health, metrics, logs, and the local NDJSON log as diagnostics.

The collector-only lane does not start Grafana, Prometheus, Jaeger, Elasticsearch, Logstash, or Kibana. The artifact-based SLO reports remain the merge-gate authority, and remote export secrets are not required.

## Full-Stack CI

Scheduled and manually dispatched CI can run the local/reference-only full-stack smoke job. Pull requests and ordinary pushes do not run it. The job sets `AURORAFLOW_OBSERVABILITY_FULL_STACK_CI_ENABLED=true`, starts the local stack, applies Elasticsearch templates, imports Kibana data views, emits smoke telemetry, and uploads:

- Typed readiness and semantic API diagnostics in `observability-backend-readiness.json` and `observability-backend-validation.json`.
- Prometheus target and metric API snapshots.
- Prometheus label, series, query, and rule snapshots plus `observability-label-snapshot.json`.
- Grafana health and datasource snapshots.
- Jaeger trace query output.
- Elasticsearch health and index snapshots.
- Kibana status and data-view validation output.
- Compose service logs.

Workflow YAML only orchestrates setup and validator commands. `npm run observability:validate` owns bounded polling and typed JSON checks for backend readiness, Collector target health, metric series, Grafana data sources, Jaeger traces, Elasticsearch indices, and Kibana data views. Failures name the exact missing invariant in the uploaded JSON diagnostics.

## Remote Export CI

For observability-related changes and on `main`, CI sets `AURORAFLOW_OBSERVABILITY_REMOTE_EXPORT_ENABLED=true` and runs the remote smoke when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured as a secret. `OTEL_EXPORTER_OTLP_HEADERS` remains optional. The workflow passes the secrets directly to OpenTelemetry and does not print headers.

## Production References

Use `observability/production` and `docs/operations/observability-production.md` as the starting point for shared deployments. Production environments must provide TLS material, credentials, storage budgets, backups, and network restrictions outside this repository.

## Stop

```bash
npm run observability:down
```

To inspect service output:

```bash
npm run observability:logs
```

## Troubleshooting

- If Grafana has no metrics, check `http://localhost:9090/targets` and verify the `otel-collector` target is up.
- If Jaeger has no traces, confirm `AURORAFLOW_OBSERVABILITY_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
- If Elasticsearch is unhealthy, raise Docker memory for the local engine or stop unrelated containers.
- If telemetry export fails, AuroraFlow should fall back to no-op behavior unless strict telemetry handling is explicitly enabled.
