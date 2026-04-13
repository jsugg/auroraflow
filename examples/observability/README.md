# Observability Examples

## Why This Exists
These examples show how to attach correlation context to logs and wrap operations with tracing spans without coupling your framework core to one telemetry vendor.

## Files
- `structured-log-correlation.ts`: correlation context helpers for structured logs.
- `otel-instrumentation.ts`: tracer/span wrapper pattern for instrumented operations.

## Common Failure Mode
Logging without run/test correlation identifiers makes CI triage slow because errors cannot be traced across retries, pages, and workflow artifacts.
