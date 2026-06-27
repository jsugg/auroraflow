# ADR 0007: Durable trend export ownership

- Status: Accepted
- Date: 2026-06-26
- Related: `AUR-ARCH-018`, `AUR-ARCH-037`, `AUR-DEC-005`, `AUR-DEC-013`, `AUR-IMPL-018`, `AUR-IMPL-030`
- Owners: maintainer / observability and SRE reviewers

## Context

AuroraFlow writes bounded, schema-versioned JSONL trend files and CI uploads them as short-lived artifacts. CI caches are evictable and do not provide a durable-history guarantee. A built-in durable exporter would require destination-specific credentials, retention, privacy, cost, availability, and incident-response ownership that the library does not have.

## Decision

Durable trend export is optional and consumer/operator-owned:

- bounded local JSONL remains the default and authoritative export input;
- AuroraFlow does not upload trends or provision a durable analytics backend;
- operators may copy validated trend artifacts to their chosen durable destination in a separate CI or operations step;
- operators own destination credentials, encryption, access control, retention, deletion, legal hold, capacity, cost, monitoring, and recovery;
- copied trend history should use the shortest useful retention, normally 30 days or less;
- export failures must be visible in the operator-owned step and must not delete or corrupt the local JSONL source;
- no hard latency, volume, or availability gate is implied before measured baseline evidence approves one.

The handoff procedure is documented in [`../operations/trend-durable-export.md`](../operations/trend-durable-export.md). No destination adapter is added until a concrete backend, owner, and support requirement exist.

## Consequences

Projects can retain long-horizon trend history without making AuroraFlow a managed storage service. The default remains lightweight and deterministic. Operators accept the work of securing, retaining, validating, and restoring exported data.

## Revisit triggers

Revisit when multiple consumers require the same destination adapter, an owner accepts its support lifecycle, and measured retention or performance evidence justifies package-owned integration.
