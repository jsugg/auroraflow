# Production Observability Reference Manifests

These files are hardened reference manifests for shared or production-like AuroraFlow observability environments. They are not used by the local developer stack.

## Required External Inputs

Provide these values through your deployment system or secret manager:

- `AURORAFLOW_OTEL_BASIC_AUTH_HTPASSWD`
- `AURORAFLOW_PROMETHEUS_BASIC_AUTH_HTPASSWD`
- `AURORAFLOW_GRAFANA_ADMIN_PASSWORD`
- `AURORAFLOW_ELASTIC_PASSWORD`
- `AURORAFLOW_KIBANA_SYSTEM_PASSWORD`
- TLS certificate/key files under `/run/secrets/auroraflow-observability/tls`

## Boundaries

- All public HTTP endpoints must use TLS.
- UIs are not anonymous.
- Collector OTLP receivers require authentication and TLS.
- Prometheus, Grafana, Elasticsearch, Kibana, and Jaeger use persistent volumes with explicit storage budgets.
- Local files in this directory are templates; environment-specific deployments should pin storage classes, DNS names, network policies, and backup targets outside this package.
