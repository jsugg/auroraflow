# ADR 0003: Scoring and SLO policy

- Status: Accepted
- Date: 2026-06-15
- Related: `AUR-ARCH-003`, `AUR-ARCH-038`, `AUR-ARCH-041`, `AUR-DEC-003`, `AUR-DEC-013`, `AUR-IMPL-004`, `AUR-IMPL-014`, `AUR-IMPL-032`
- Owners: QA/SRE / maintainer

## Context

Self-healing candidate scores, dashboard targets, alert policies, and Prometheus rules can drift if each file owns thresholds independently. Premature blocking SLO gates would also create noisy CI without operational baseline data.

## Decision

Scoring and SLO thresholds are QA/SRE-owned policy:

- self-healing scoring weights and confidence thresholds must stay source-backed and contract-tested;
- SLO dashboard targets, alert policy JSON, and Prometheus rule thresholds must stay drift-tested;
- alert breaches warn by default;
- blocking SLO gates require an explicit policy update and evidence from measured CI/project behavior;
- failure-path latency and artifact-volume budgets start baseline-first and warning-only.

## Consequences

Threshold changes become intentional policy changes rather than incidental constants. CI remains informative without blocking on immature operational signals.

## Revisit triggers

Revisit when benchmark history, failure rates, user impact, or maintainer capacity supports stricter gates.
