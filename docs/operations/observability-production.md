# Observability Production Operations

AuroraFlow production observability environments must be deployed from hardened, environment-owned infrastructure. The reference manifests in `observability/production/` define the minimum security and resource posture.

## Deployment Requirements

- Terminate TLS on every public endpoint: Collector OTLP, Prometheus, Grafana, Jaeger, Elasticsearch, and Kibana.
- Disable anonymous UI access.
- Store credentials and private keys in a secret manager, not in repository files.
- Restrict network access so test runners can reach only the Collector and operators can reach only the required UIs.
- Keep the artifact pipeline enabled; live telemetry must not be the only merge-gate evidence.

## Remote Export

CI remote export runs for observability-related changes and on `main` when endpoint secrets are configured:

- Secret: `OTEL_EXPORTER_OTLP_ENDPOINT`
- Optional secret: `OTEL_EXPORTER_OTLP_HEADERS`

The workflow sets `AURORAFLOW_OBSERVABILITY_REMOTE_EXPORT_ENABLED=true`, passes these values directly to OpenTelemetry environment variables, and uploads only smoke diagnostics. Do not echo headers or endpoint credentials in workflow logs.

## Storage Budgets

| Backend | Default Budget | Retention Target | Notes |
| --- | --: | --: | --- |
| Prometheus | 20 GB | 30 days | Prefer remote write for longer retention. |
| Grafana | 1 GB | source-controlled dashboards | Back up database only if UI edits are allowed. |
| Jaeger | 20 GB | 7-14 days | Use durable storage or a managed trace backend for shared environments. |
| Elasticsearch | 100 GB | 14-30 days | Enforce ILM before indexing persistent logs. |
| Collector | 1 GB memory | n/a | Batch and memory limiter must stay enabled. |

Raise budgets only after reviewing cardinality, shard count, and dashboard query costs.

## Backup and Restore

1. Export Grafana dashboards and data sources after approved UI changes, then commit the exported JSON/YAML.
2. Snapshot Elasticsearch indices to environment-owned object storage before changing ILM, templates, or version.
3. Back up Prometheus blocks or use remote write if historical metrics are required.
4. Store TLS CA, issued certificates, and credential rotation metadata in the deployment secret manager.
5. Test restore into an isolated environment before relying on backups for incident recovery.

## Release Checklist

- `docker compose -f observability/production/docker-compose.yml config` succeeds with deployment secrets injected.
- TLS certificate chain validates from runner and operator networks.
- Prometheus targets are up and alert rules load.
- Grafana data sources are healthy and dashboards are provisioned from source.
- Jaeger receives a synthetic trace.
- Elasticsearch ILM policies and index templates are installed before Logstash indexing starts.
- Kibana data views and saved searches import successfully.
- Retention, backup, and restore owners are documented for the environment.
