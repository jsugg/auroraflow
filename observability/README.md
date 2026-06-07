# AuroraFlow Observability Stack

This local stack extends the existing JSON and Markdown artifacts with live OpenTelemetry signals. Telemetry remains opt-in; package consumers get no live export unless they enable it explicitly.

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

## Files

- `docker-compose.observability.yml` starts the Collector, Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, and Kibana.
- `observability/otel-collector/config.yaml` receives OTLP over HTTP and gRPC, exposes Prometheus metrics on `9464`, and exports traces to Jaeger.
- `observability/prometheus/prometheus.yml` scrapes the Collector and loads local alert rules.
- `observability/grafana/provisioning` provisions Prometheus, Elasticsearch, Jaeger, and starter dashboards.
- `observability/logstash/pipeline/auroraflow.conf` reads structured logs and self-healing artifacts from local mounted paths.
- `observability/elastic/index-templates` and `observability/elastic/ilm` provide optional Elasticsearch templates and local retention policy definitions.
- `observability/kibana/saved-objects` provides importable data views for log and self-healing exploration.
- `observability/production` provides reference manifests for TLS/auth-enabled shared deployments.

## Environment

- `AURORAFLOW_OBSERVABILITY_ENABLED=true` enables runtime telemetry.
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` sends telemetry to the local Collector.
- `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true` may include raw selectors for local debugging only. Keep it disabled for CI and shared environments.

## Logs

Logstash reads JSON lines from `logs/*.ndjson` and self-healing artifacts from `test-results/self-healing/*.json`. Secret-like field names and inline `key=value` fragments are redacted before indexing, and malformed JSON log lines are routed to `auroraflow-ingest-dead-letter-*` for triage.

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

Pull-request CI runs a lightweight collector-only smoke lane for observability-related changes unless the repository variable `AURORAFLOW_OBSERVABILITY_CI_ENABLED` is set to `false`. The lane uses `docker-compose.observability-ci.yml` and `observability/otel-collector/ci-config.yaml`, emits one synthetic trace/metric/log event, and uploads collector health, metrics, logs, and the local NDJSON log as diagnostics.

The collector-only lane does not start Grafana, Prometheus, Jaeger, Elasticsearch, Logstash, or Kibana. The artifact-based SLO reports remain the merge-gate authority, and remote export secrets are not required.

## Optional Full-Stack CI

Set `AURORAFLOW_OBSERVABILITY_FULL_STACK_CI_ENABLED=true` to run the full-stack CI smoke job for observability-related changes. The job starts the local stack, applies Elasticsearch templates, imports Kibana data views, emits smoke telemetry, and uploads:

- Prometheus target and metric API snapshots.
- Grafana health and datasource snapshots.
- Jaeger trace query output.
- Elasticsearch health and index snapshots.
- Kibana status and data-view validation output.
- Compose service logs.

## Optional Remote Export CI

Set `AURORAFLOW_OBSERVABILITY_REMOTE_EXPORT_ENABLED=true` and configure `OTEL_EXPORTER_OTLP_ENDPOINT` plus optional `OTEL_EXPORTER_OTLP_HEADERS` secrets to smoke-test a remote Collector. The workflow passes the secrets directly to OpenTelemetry and does not print headers.

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
