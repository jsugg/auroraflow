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

`npm run observability:smoke` runs the same command after the stack is up.

## Files

- `docker-compose.observability.yml` starts the Collector, Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, and Kibana.
- `observability/otel-collector/config.yaml` receives OTLP over HTTP and gRPC, exposes Prometheus metrics on `9464`, and exports traces to Jaeger.
- `observability/prometheus/prometheus.yml` scrapes the Collector and loads local alert rules.
- `observability/grafana/provisioning` provisions Prometheus, Elasticsearch, Jaeger, and starter dashboards.
- `observability/logstash/pipeline/auroraflow.conf` reads structured logs and self-healing artifacts from local mounted paths.

## Environment

- `AURORAFLOW_OBSERVABILITY_ENABLED=true` enables runtime telemetry.
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` sends telemetry to the local Collector.
- `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true` may include raw selectors for local debugging only. Keep it disabled for CI and shared environments.

## Logs

Logstash reads JSON lines from `logs/*.ndjson` and self-healing artifacts from `test-results/self-healing/*.json`. Known secret-like `message` fragments are redacted before indexing. Shared environments need stronger upstream redaction, TLS, authentication, and retention policies before persistent indexing is enabled.

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
