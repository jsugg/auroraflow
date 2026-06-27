# Observability Support Tiers

AuroraFlow is artifact-first. JSON, Markdown, and bounded JSONL artifacts are deterministic evidence; live telemetry and every observability service are optional.

## Support boundary

| Tier | Support level | Runtime and infrastructure | Commands and validation | Ownership |
| --- | --- | --- | --- | --- |
| Artifact-only | Supported default | Telemetry facade is no-op; no Collector or backend required. | Normal report commands, unit tests, contracts, and schema checks. | Consumer owns CI artifact retention; AuroraFlow owns artifact formats and tests. |
| Lite | Best effort, opt-in | Collector-only topology receives OTLP and exposes health/diagnostics; no Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, or Kibana. | `npm run observability:lite:up`, `npm run observability:lite:smoke`, `npm run observability:lite:down`; path-filtered collector smoke in CI. | Consumer/operator owns lifecycle, endpoint security, diagnostics, capacity, and any downstream storage. |
| Full | Local/reference only | Local Collector, Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, and Kibana reference stack. | `npm run observability:up`, `npm run observability:smoke`, `npm run observability:live-assert`, `npm run observability:down`; scheduled/manual full-stack smoke. | Consumer/operator owns resources and all shared or production hardening. AuroraFlow provides reference assets, not production operations. |

Production is not a fourth supported tier. `observability/production` contains reference manifests only. Any shared or production deployment must provide an explicit operator for credentials, TLS, storage, retention, backups, networking, capacity, upgrades, monitoring, and on-call response.

## Default behavior

Local development remains artifact-only. Without `AURORAFLOW_OBSERVABILITY_ENABLED=true`, telemetry initialization returns the no-op implementation and does not contact an OTLP endpoint. Starting Lite or Full infrastructure never changes the runtime setting automatically.

Enabling live telemetry is explicit:

```bash
AURORAFLOW_OBSERVABILITY_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm run test:smoke
```

Raw selectors remain suppressed unless the local-debug-only `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true` opt-in is also set.

## Smoke policy

- Artifact-only unit coverage proves empty environment configuration is disabled and initializes no-op telemetry.
- Lite smoke validates the collector-only Compose topology, health endpoint, real OTLP trace/metric export, and diagnostic artifacts.
- Full smoke invokes the typed `observability:validate` Node validator for bounded readiness and semantic API checks, then validates live Prometheus labels on schedule or manual dispatch; it is not a routine pull-request or production support promise.
- Validator runs always write `observability-backend-readiness.json` or `observability-backend-validation.json` with per-check backend, URL, attempts, status, evidence, and exact failure message. Workflow YAML only orchestrates validator and snapshot commands.
- Secret-gated remote export is operator-provided endpoint validation, not AuroraFlow ownership of that backend.

See [observability contract](./observability-contract.md), [stack architecture](../architecture/observability-stack.md), and [`observability/README.md`](../../observability/README.md).
