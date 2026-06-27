# ADR 0009: Strategic structure — package split, hosted SAT, and observability repository

- Status: Accepted
- Date: 2026-06-27
- Related decisions: `AUR-DEC-008`, `AUR-DEC-009`, `AUR-DEC-010`; ADR 0005, ADR 0008
- Owners: maintainer / product, architecture, observability, and release reviewers

## Context

This record covers the three largest deferred structural expansion vectors: splitting the single npm package, building a hosted Selector Analysis Tooling (SAT) service, and extracting observability assets into a companion repository.

This ADR builds on the adoption-readiness assessment in [ADR 0008](0008-adoption-gated-extensibility.md) and [`../architecture/adoption-readiness.md`](../architecture/adoption-readiness.md), which found no external npm publication, no download record, and no open or closed GitHub issue demand for `jsugg/auroraflow` on 2026-06-27.

This ADR is decision-only and authorizes no implementation: no package split, no hosted service, and no repository extraction occurs from this record.

## Decision

A single shared evidence gate applies to every expansion below. None may begin until a successor ADR records all four of **adoption evidence, a named owner, a migration plan, and a release strategy**.

### 1. Package split

AuroraFlow keeps one `auroraflow` npm package. No monorepo, workspaces, or `core`/`self-healing`/`redis`/`observability` package split is created now. Beyond the shared gate, a future split additionally requires a compatibility strategy and named package owners before any implementation. Continue with the single package.

### 2. Hosted SAT

Hosted SAT remains a deferred non-goal. AuroraFlow stays a library and test framework and does not become a service platform: no service APIs, tenancy, hosted selector registry or history, authentication, billing, SLAs, or on-call systems are built.

This is distinct from feature-level SAT. Feature-level SAT (Selector Analysis Tooling) remains implemented and supported as the in-process selector-analysis enrichment for `suggest` and `guarded` artifacts; only the hosted, managed-service form is deferred. A maintainer who ever reverses this would need a funded product mandate, dedicated service ownership, a security and compliance model, multi-tenancy and data-isolation design, SRE/on-call capacity, and a successor ADR.

### 3. Observability repository

Observability assets remain in-package. No companion observability repository is extracted. The Collector/Prometheus/Grafana/Jaeger/ELK assets, dashboards, and workflows stay in this repository under the artifact-first, optional, local/reference boundary set by [ADR 0005](0005-observability-boundary.md). Keeping them in-package preserves documentation/asset/test synchronization and avoids a second release lifecycle while adoption is unproven. Beyond the shared gate, a future extraction additionally requires a named support owner, a documented support boundary, and a release-coupling plan.

## Consequences

Maintenance stays proportional to observed adoption: one package, one release lifecycle, an in-process feature-level SAT, and in-repository observability references. Contributors get a clear, stable boundary and are not implicitly promised a managed service, split packages, or a separate observability product. The cost is a slower response for early adopters who want any of these before they can supply adoption evidence, a named owner, a migration plan, and a release strategy.

## Revisit triggers

Revisit only when the adoption-readiness report can cite the shared gate — adoption evidence, a named owner, a migration plan, and a release strategy — plus the decision-specific evidence:

- package split: install-weight or dependency complaints, or repeated independent requests for separately versioned packages with a committed owner;
- hosted SAT: a funded product mandate with security, compliance, and SRE ownership;
- observability repository: a named support owner and a release-coupling plan for an independent observability asset lifecycle.

Record any reversal in a successor ADR; do not edit this record in place.
