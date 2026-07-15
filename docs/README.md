# AuroraFlow documentation

This page is the canonical index for AuroraFlow's documentation. Every non-template document under `docs/`, plus the repository's root guides, is reachable from here, and a contract test fails when a document is added without indexing it.

AuroraFlow is pre-publish. The [release process](operations/release-process.md#current-state-dry-run-only) holds the canonical release-state declaration; no other document restates publish status.

## Compliance standard

AuroraFlow's documentation is compliant when required documents exist, are discoverable, accurately describe current executable behavior, identify their audience and ownership, pass automated checks, and are updated in the same change that alters their contract.

## Package consumer

You install AuroraFlow into a test project and call its API.

| Document | What it answers |
| --- | --- |
| [Project overview](../README.md) | What AuroraFlow is, what is implemented, and what is not. |
| [Getting started](getting-started.md) | Installing (pre-publish and post-publish), configuring Playwright, and writing a first page object and test. |
| [API](api.md) | Import paths, signatures, guarantees, errors, and lifecycle for the public surface. |
| [API stability](api-stability.md) | Which exports are stable, advanced, experimental, deprecated, or internal, and the deprecation policy. |
| [Configuration](configuration.md) | Every `SELF_HEAL_*`, `AURORAFLOW_*`, `REDIS_*`, and `LOG_*` variable, with defaults and clamps. |
| [Changelog](../CHANGELOG.md) | The durable record of releases, deprecations, and removals. |

## Test author

You write and maintain Playwright tests built on AuroraFlow page objects.

| Document | What it answers |
| --- | --- |
| [Writing tests](writing-tests.md) | Test structure, selector ownership, and determinism expectations. |
| [Self-healing foundation](architecture/self-healing.md) | How mode-gated failure capture, candidate scoring, and guarded validation behave. |
| [Lifecycle contract](operations/lifecycle.md) | `closeAuroraFlow(context?)`, the `auroraflow/playwright` fixture, and cleanup guarantees. |
| [Artifact schemas](operations/artifact-schemas.md) | The JSON Schemas and compatibility fixtures that artifacts must satisfy. |
| [Flakiness analytics](operations/flakiness-analytics.md) | Turning Playwright matrix output into a deterministic flakiness summary. |
| [SLO dashboard and alerting](operations/slo-dashboard-alerting.md) | Deriving SLO metrics from flakiness telemetry and evaluating alert policies. |

## Contributor

You change code, tests, or documentation in this repository.

| Document | What it answers |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | The contribution entry point: validation matrix, guardrails, and governance. |
| [Development guide](development.md) | Local setup, verification gates, source layout, CI topology, and documentation rules. |
| [Locator-first API design](architecture/locator-first-api.md) | The reviewed design for locator-first page actions, ahead of prototypes. |
| [Mutation and property baseline](quality/mutation-property-baseline.md) | The assertion-quality baseline for calibration-critical code. |
| [Failure-path performance baseline](quality/failure-path-performance-baseline.md) | Measured failure-path cost, recorded before any budget becomes enforceable. |

## Maintainer and release owner

You own releases, architecture decisions, and the durable record of both.

| Document | What it answers |
| --- | --- |
| [Release process](operations/release-process.md) | Canonical release state, dry-run evidence, versioning, provenance/SBOM policy, and rollback. |
| [Architecture decision log](architecture/decision-log.md) | The durable source for `AUR-DEC-*` policy decisions. |
| [Architecture and QE traceability registry](architecture/traceability.md) | Completed architectural and quality-engineering improvements, and deferred decisions. |
| [Adoption readiness and extensibility gates](architecture/adoption-readiness.md) | The evidence gates that must pass before any backend or CI expansion. |
| [Architecture decision records](adr/README.md) | The ADR index and template. |

### Architecture decision records

| ADR | Decision |
| --- | --- |
| [ADR 0001](adr/0001-safety-first-self-healing.md) | Safety-first self-healing. |
| [ADR 0002](adr/0002-api-stability-tiers.md) | API stability tiers. |
| [ADR 0003](adr/0003-scoring-and-slo-policy.md) | Scoring and SLO policy. |
| [ADR 0004](adr/0004-redis-strategy.md) | Redis strategy. |
| [ADR 0005](adr/0005-observability-boundary.md) | Observability boundary. |
| [ADR 0006](adr/0006-release-policy.md) | Release policy. |
| [ADR 0007](adr/0007-durable-trend-export.md) | Durable trend export ownership. |
| [ADR 0008](adr/0008-adoption-gated-extensibility.md) | Adoption-gated backend and CI extensibility. |
| [ADR 0009](adr/0009-strategic-architecture.md) | Strategic structure: package split, hosted SAT, and observability repository. |
| [ADR 0010](adr/0010-ci-cd-maturity-deferrals.md) | CI/CD maturity deferrals. |

## Security and privacy reviewer

You assess what AuroraFlow captures, what it stores, and how vulnerabilities are reported.

| Document | What it answers |
| --- | --- |
| [Security policy](../SECURITY.md) | Supported versions, private vulnerability reporting, and scope exclusions. |
| [Secrets management policy](operations/security-secrets.md) | Minimum secret-handling requirements for development and CI. |
| [Artifact privacy and retention](operations/privacy-retention.md) | Data classes captured, capture controls, and consumer-owned retention. |

## Redis and observability operator

You run the optional infrastructure AuroraFlow can integrate with. Both are consumer-owned.

| Document | What it answers |
| --- | --- |
| [Data layer foundation](architecture/data-layer.md) | Selector-store primitives and the store contract. |
| [Redis production runbook](operations/redis-production-runbook.md) | Key model, TLS, auth, backup/restore, eviction, capacity, and incident guidance. |
| [Observability stack architecture](architecture/observability-stack.md) | How opt-in OpenTelemetry signals route to development backends. |
| [Observability contract](operations/observability-contract.md) | The opt-in telemetry boundary and the no-op default. |
| [Observability support tiers](operations/observability-support-tiers.md) | What is supported, best-effort, and reference-only. |
| [Observability production operations](operations/observability-production.md) | What environment owners must provide before production use. |
| [Observability runbooks](operations/observability-runbooks.md) | Triage for missing telemetry and backend faults. |
| [Observability dashboard review](operations/observability-dashboard-review.md) | The checklist for dashboard and alert changes. |
| [Durable trend export](operations/trend-durable-export.md) | The optional, operator-owned durable trend path. |

## Writing a new document

Templates capture the information a reader needs, not a layout to reproduce. Cover each item somewhere findable; merge, reorder, or rename sections when that serves the material better.

| Template | Use it for |
| --- | --- |
| [Architecture document](templates/architecture-doc.md) | A new document under `architecture/`. Cover context, scope, components and data flow, invariants, trust boundaries, failure modes, and related decisions. Reference implementation: [data layer foundation](architecture/data-layer.md). |
| [Runbook](templates/runbook.md) | A new operational document under `operations/`. Cover scope, ownership, prerequisites, detection, mitigation, recovery, verification, escalation, and rollback. Reference implementation: [Redis production runbook](operations/redis-production-runbook.md). |

Two document kinds have expectations but no template, because the existing documents are the clearest specification of them. An **API reference** entry gives the import path, the signature, the guarantees it holds, the errors it raises, its lifecycle, at least one example, and its stability tier — [API](api.md) is the reference implementation. A **tutorial** gives prerequisites, reproducible steps, the expected result, cleanup, and troubleshooting — [Getting started](getting-started.md) is the reference implementation.

High-risk documents — those governing release, security, privacy, compatibility, or production Redis — additionally carry YAML front matter recording `owner`, `status`, `audience`, `last-reviewed`, `review-interval-days`, and `update-triggers`. A contract enforces it on those five documents; tutorials stay metadata-free rather than accumulating bureaucracy.

## Exceptions and waivers

A documentation requirement that is deliberately not met is recorded as a waiver, so the gap is a visible decision with an owner and an expiry rather than an undocumented lapse. See [exceptions](exceptions/README.md) for when a waiver is the right answer and [the waiver template](exceptions/TEMPLATE.md) for the fields one must record. There are currently no active waivers.

## Conventions

- **Normative words carry contract weight.** "Must", "supported", "guaranteed", and "required" describe commitments a contract test or workflow enforces. Use "prefer", "consider", or "recommended" for advice. Do not use a normative word for behavior nothing checks.
- **Implemented before roadmap.** "Implemented", "available", and "enabled by" are only for behavior present in source; use "planned", "reference", or "roadmap" otherwise. The full rule lives in the [development guide](development.md).
- **Publish status derives from one place.** The [release process](operations/release-process.md#current-state-dry-run-only) is the canonical release-state declaration. Link it rather than restating whether the package is published.
- **Dates are ISO.** `YYYY-MM-DD`, everywhere, including front matter.
- **Identifiers use the governance namespaces.** `AUR-DEC-*` for decisions in the [decision log](architecture/decision-log.md), `AUR-ARCH-*` for architecture issues. ADR files are numbered `NNNN-kebab-title.md`. No other identifier namespace is in use.
- **Filenames are kebab-case `.md`**, named for the subject rather than the audience.
- **Every code fence carries a language tag** (`ts`, `bash`, `json`, `yaml`, `text`, `mermaid`). TypeScript fences in the consumer-facing documents are compiled by `npm run docs:snippets`, so an untagged fence silently escapes that check.
- **A diagram supplements prose; it never replaces it.** Mermaid is welcome, but a reader who cannot render the diagram must not lose information — the surrounding prose has to carry the explanation on its own.
- **Links are relative and checked.** `npm run docs:links` validates every relative target, anchor, image alt text, heading progression, and link text. Link text names its destination; "here" and "link" do not.
