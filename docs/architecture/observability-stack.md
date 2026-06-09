# Observability Stack Architecture

AuroraFlow now has a local observability stack configuration that routes opt-in OpenTelemetry signals to version-controlled development backends. The stack extends the existing artifact pipeline; JSON and Markdown reports remain the deterministic merge-gate source.

## Scope

Implemented in source:

- OpenTelemetry telemetry facade with no-op defaults.
- Page action, Redis, self-healing, flakiness, SLO dashboard, and SLO alert telemetry hooks.
- Local Docker Compose overlay for OpenTelemetry Collector, Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, and Kibana.
- Opt-in CI lanes for collector-only, full-stack backend snapshot, live Prometheus label assertions, and remote OTLP export smoke validation.
- Version-controlled Collector, Prometheus, Grafana provisioning, dashboard, Logstash, Elasticsearch, and Kibana config.
- Reference production manifests with TLS/auth settings, storage budgets, backup guidance, runbooks, and dashboard review controls.
- Contract tests that assert required stack files, services, ports, scrape targets, data sources, dashboard JSON, and Prometheus label semantics are present.

Environment-specific work remains outside this repository:

- Provisioning real production DNS, certificates, storage classes, and network policy.
- Enabling full-stack or remote-export CI variables in environments that have sufficient runner capacity and secrets.

## Signal Flow

```mermaid
flowchart LR
  Tests[Playwright Tests] --> Runtime[AuroraFlow Runtime]
  Runtime --> Facade[Telemetry Facade]
  Facade --> Collector[OpenTelemetry Collector]
  Collector --> Prometheus[Prometheus]
  Collector --> Jaeger[Jaeger]
  Runtime --> Logs[Structured Logs]
  Logs --> Logstash[Logstash]
  Logstash --> Elasticsearch[Elasticsearch]
  Elasticsearch --> Kibana[Kibana]
  Prometheus --> Grafana[Grafana]
  Elasticsearch --> Grafana
  Jaeger --> Grafana
```

The Collector receives OTLP over HTTP and gRPC, batches signals, exposes metrics for Prometheus scrape, and exports traces to Jaeger. Logstash tails local JSON logs and self-healing artifacts, applies recursive redaction for known secret-shaped fields, routes malformed log records to a dead-letter index, and writes local Elasticsearch indices.

## Local Operation

Start the stack:

```bash
npm run observability:up
```

Emit framework telemetry:

```bash
AURORAFLOW_OBSERVABILITY_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm run test:smoke
```

Run a deterministic stack smoke emitter:

```bash
npm run observability:smoke
```

Open the local tools:

- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Jaeger: http://localhost:16686
- Kibana: http://localhost:5601
- Collector health: http://localhost:13133

Stop the stack:

```bash
npm run observability:down
```

## Privacy and Cardinality

Telemetry remains opt-in. Raw selectors, URLs, request bodies, passwords, tokens, and cookies are not emitted by default. Page action telemetry uses stable target hashes and low-cardinality metric labels. `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true` is only for local debugging and should stay disabled in CI and shared environments.

Prometheus labels should remain bounded to normalized dimensions such as `auroraflow_action_type`, `auroraflow_page_object`, `auroraflow_action_status`, `auroraflow_project`, `auroraflow_shard`, `auroraflow_redis_operation`, `auroraflow_redis_operation_status`, `auroraflow_self_heal_mode`, and `auroraflow_self_heal_strategy`. High-cardinality data belongs in traces or logs after hashing or redaction.

Run `npm run observability:live-assert` against the local stack to poll Prometheus series and write `observability-label-snapshot.json`; dashboard expressions and alert rules must reference only exported labels/status values captured there.

## Configuration Files

- `docker-compose.observability.yml`: local stack overlay.
- `observability/otel-collector/config.yaml`: OTLP receivers, memory limiter, resource processor, batch processor, Prometheus exporter, Jaeger exporter, health check.
- `observability/prometheus/prometheus.yml`: Collector scrape and local rule loading.
- `observability/prometheus/rules/auroraflow.yml`: warning-level local SLO and operations alerts.
- `observability/grafana/provisioning`: Prometheus, Elasticsearch, Jaeger data sources and dashboard provider.
- `observability/grafana/dashboards`: starter dashboards for overview, CI matrix, flakiness, self-healing, page actions, Redis, and Collector health using snapshot-asserted Prometheus labels.
- `observability/logstash/pipeline/auroraflow.conf`: local log and self-healing artifact ingestion.
- `observability/elastic/elasticsearch.yml` and `observability/kibana/kibana.yml`: local single-node settings.
- `observability/production`: reference production manifests that enable TLS/auth and persistent storage.
- `docs/operations/observability-production.md`: production storage budgets plus backup and restore guidance.
- `docs/operations/observability-runbooks.md`: operational triage paths for telemetry gaps, backpressure, cardinality, storage pressure, trace gaps, and dashboard drift.
- `docs/operations/observability-dashboard-review.md`: dashboard and alert review checklist.

## Production Boundary

The local stack disables security features where needed for developer ergonomics and binds exposed ports to localhost. Do not reuse it as production infrastructure. Shared environments need TLS, authentication, retention policy, resource limits, protected secret handling, and explicit storage budgets before persistent observability data is enabled.
