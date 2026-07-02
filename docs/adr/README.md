# Architecture Decision Records

This directory contains durable architecture decision records for AuroraFlow. Keep ADRs short, dated, and tied to the `AUR-ARCH-*` issue or `AUR-DEC-*` decision that made the policy necessary. Traceability keys that appear outside ADRs are defined in [Architecture and QE Traceability Registry](../architecture/traceability.md).

## ADR index

| ADR                                              | Status   | Decision area                |
| ------------------------------------------------ | -------- | ---------------------------- |
| [ADR 0001](0001-safety-first-self-healing.md)    | Accepted | Safety-first self-healing    |
| [ADR 0002](0002-api-stability-tiers.md)          | Accepted | API stability tiers          |
| [ADR 0003](0003-scoring-and-slo-policy.md)       | Accepted | Scoring and SLO policy       |
| [ADR 0004](0004-redis-strategy.md)               | Accepted | Redis strategy               |
| [ADR 0005](0005-observability-boundary.md)       | Accepted | Observability boundary       |
| [ADR 0006](0006-release-policy.md)               | Accepted | Release policy               |
| [ADR 0007](0007-durable-trend-export.md)         | Accepted | Durable trend export         |
| [ADR 0008](0008-adoption-gated-extensibility.md) | Accepted | Adoption-gated extensibility |
| [ADR 0009](0009-strategic-architecture.md)       | Accepted | Strategic structure          |
| [ADR 0010](0010-ci-cd-maturity-deferrals.md)     | Accepted | CI/CD maturity deferrals     |

## Lightweight process

- Write an ADR when a change affects safety behavior, compatibility, release posture, data retention, support boundaries, or ownership.
- Prefer a concise ADR over a broad RFC.
- Link evidence and validation commands when a decision depends on tests or workflow behavior.
- Revisit an ADR only with new evidence, and record the successor ADR instead of silently editing history.

## Template

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR NNNN
- Date: YYYY-MM-DD
- Related: `AUR-ARCH-*`, `AUR-DEC-*`
- Owners: maintainer / domain owner

## Context

What forced this decision?

## Decision

What policy do we now follow?

## Consequences

What becomes easier, harder, or explicitly out of scope?

## Revisit triggers

What evidence would justify changing the decision?
```
