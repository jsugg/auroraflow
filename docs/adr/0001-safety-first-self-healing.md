# ADR 0001: Safety-first self-healing

- Status: Accepted
- Date: 2026-06-15
- Related: `AUR-DEC-002`
- Owners: maintainer / self-healing owner

## Context

Self-healing can reduce locator maintenance cost, but unsafe automation can hide product regressions or mutate selectors without review. AuroraFlow governance therefore treats safety-first behavior as a preservation guardrail.

## Decision

AuroraFlow self-healing remains opt-in and safety-first:

- default mode is `off`;
- guarded behavior must be policy-gated, confidence-gated, and dry-run validated;
- the default confidence policy is registry-curated-first, not fresh-DOM auto-acceptance;
- supported auto-apply paths may retry once, and failed retries must preserve the original failure;
- source-code rewrites and blind selector mutation remain out of scope;
- registry promotion writes require review records now and protected/shared authorization before broader shared use.

## Consequences

This keeps failure evidence auditable and avoids surprising test mutations. It also means some valid DOM candidates remain suggestions until registry history, scoring evidence, and review policy justify acceptance.

## Revisit triggers

Revisit only if reachability fixtures prove a broader default is safe, promotion authorization is implemented for shared workflows, and the decision log or a successor ADR updates `AUR-DEC-002`.
