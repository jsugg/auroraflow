# ADR 0005: Observability boundary

- Status: Accepted
- Date: 2026-06-15
- Related: `AUR-ARCH-019`, `AUR-ARCH-021`, `AUR-ARCH-041`, `AUR-ARCH-042`, `AUR-DEC-008`, `AUR-IMPL-019`, `AUR-IMPL-031`, `AUR-IMPL-040`
- Owners: maintainer / observability reviewers

## Context

AuroraFlow produces deterministic JSON/Markdown evidence and can export OpenTelemetry signals, but the full local stack is too heavy to become a default or production-support promise.

## Decision

Observability remains artifact-first:

- JSON/Markdown artifacts are the deterministic merge-gate evidence;
- live telemetry is opt-in and no-op by default;
- artifact-only operation is the supported default;
- the collector-only Lite tier is opt-in and best effort;
- the full Collector/Prometheus/Grafana/Jaeger/ELK stack is local/reference only;
- production deployment requires environment-specific ownership for credentials, TLS, storage, retention, networking, capacity, and on-call support;
- raw selectors and sensitive data stay suppressed unless an explicit opt-in permits them.

The executable topology, commands, ownership, and smoke boundary for each tier are documented in [`../operations/observability-support-tiers.md`](../operations/observability-support-tiers.md).

## Consequences

Consumers can adopt the library without running observability infrastructure. Teams that want live telemetry have reference assets and contracts, but production ownership remains outside the package.

## Revisit triggers

Revisit if user demand and maintainer capacity justify a supported lite profile or separate observability asset lifecycle.
