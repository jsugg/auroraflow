# Observability Production Operations

AuroraFlow production observability environments must be deployed from hardened, environment-owned infrastructure. The reference manifests in `observability/production/` define the minimum security and resource posture.

## Deployment Requirements

- Terminate TLS on every public endpoint: Collector OTLP, Prometheus, Grafana, Jaeger, Elasticsearch, and Kibana.
- Disable anonymous UI access.
- Store credentials and private keys in a secret manager, not in repository files.
- Restrict network access so test runners can reach only the Collector and operators can reach only the required UIs.
- Keep the artifact pipeline enabled; live telemetry must not be the only merge-gate evidence.

## Remote Export

There is **no standing remote-export CI job**. AuroraFlow does not own an OTLP/HTTP backend, so a permanently-configured lane would never do real work (its endpoint secret is unset) and could only ever be a runner-consuming no-op. It was removed; the local Lite and Full lanes validate real export against `http://localhost:4318`.

An operator who owns an OTLP/HTTP backend can add the lane below. Because it has no backend-receipt query proving the run-scoped marker arrived, it is a **Remote Export Connectivity Smoke**, not end-to-end validation. Before enabling it you must have all of: a named owner; a selected OTLP/HTTP-compatible backend; the repository variable `AURORAFLOW_OBSERVABILITY_REMOTE_EXPORT_ENABLED=true`; endpoint and header secrets; and documented cost, retention, privacy, and incident ownership. Never invent an endpoint — use the provider- or operator-issued OTLP/HTTP base endpoint.

```yaml
# Operator-owned workflow example (not shipped in .github/workflows).
name: Observability Remote Export Connectivity Smoke
on:
  workflow_dispatch:
  schedule:
    - cron: '0 7 * * 1'
permissions:
  contents: read
jobs:
  remote-export-connectivity-smoke:
    name: Remote Export Connectivity Smoke
    runs-on: ubuntu-latest
    # Fail closed: enable variable must be set AND the endpoint secret present.
    if: vars.AURORAFLOW_OBSERVABILITY_REMOTE_EXPORT_ENABLED == 'true'
    timeout-minutes: 8
    env:
      OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}
      OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Fail closed when the endpoint secret is absent
        run: test -n "${OTEL_EXPORTER_OTLP_ENDPOINT}" || { echo "endpoint secret missing"; exit 1; }
      # ... setup Node, then:
      - name: Emit remote smoke telemetry
        env:
          AURORAFLOW_OBSERVABILITY_ENABLED: 'true'
          AURORAFLOW_OBSERVABILITY_ENVIRONMENT: ci
          AURORAFLOW_OBSERVABILITY_STRICT: 'true'
        run: npm run observability:ci:smoke
```

Pass the endpoint/header secrets directly to the OpenTelemetry environment variables and upload only smoke diagnostics. Do not echo headers or endpoint credentials in workflow logs. Promote it to end-to-end validation only once a backend receipt query proves the run-scoped marker arrived.

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
