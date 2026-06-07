# TLS Material

Mount environment-specific certificates here in production deployments:

- `ca.crt`
- `otel-collector.crt` / `otel-collector.key`
- `prometheus.crt` / `prometheus.key`
- `grafana.crt` / `grafana.key`
- `jaeger.crt` / `jaeger.key`
- `elasticsearch.crt` / `elasticsearch.key`
- `kibana.crt` / `kibana.key`

Do not commit private keys or generated secrets.
