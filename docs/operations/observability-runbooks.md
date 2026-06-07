# Observability Runbooks

## No Telemetry Arriving

1. Confirm `AURORAFLOW_OBSERVABILITY_ENABLED=true`.
2. Confirm the process uses the expected `OTEL_EXPORTER_OTLP_ENDPOINT`.
3. Check Collector health on `/` or the configured health endpoint.
4. Inspect Collector logs for authentication, TLS, receiver, or exporter errors.
5. Run `npm run observability:ci:smoke` against the target Collector.

## Collector Backpressure or Dropped Data

1. Check Collector memory limiter and batch processor metrics.
2. Reduce test-run fan-out or add Collector replicas behind a load balancer.
3. Confirm exporters are not retrying due to backend auth/TLS failures.
4. Increase memory only after verifying signal cardinality is bounded.

## High Cardinality

1. Query top label cardinality in Prometheus.
2. Confirm selectors, URLs, test titles, and exception messages are not metric labels.
3. Move high-cardinality details to traces or redacted logs.
4. Keep `AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=false` outside local debugging.

## Elasticsearch Disk Pressure

1. Check shard count, index sizes, and ILM phase status.
2. Stop non-essential ingestion before disk watermarks block writes.
3. Shorten retention or increase storage according to the approved budget.
4. Snapshot before deleting indices when incident review data may be needed.

## Jaeger Trace Gaps

1. Verify Collector trace pipeline has the OTLP receiver, memory limiter, batch processor, and Jaeger exporter.
2. Confirm test process shutdown completed without telemetry flush errors.
3. Search by `service.name=auroraflow` and recent time windows.
4. Check whether sampling or backend retention dropped expected traces.

## Grafana Provisioning Drift

1. Compare live dashboards and data sources against files under `observability/grafana`.
2. Export approved UI changes back into source before relying on them.
3. Revert unapproved manual edits in the UI.
4. Run observability contract tests after updating dashboards.
