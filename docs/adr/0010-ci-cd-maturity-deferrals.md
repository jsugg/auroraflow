# ADR 0010: CI/CD maturity deferrals

- Status: Accepted
- Date: 2026-07-02
- Related decisions: `AUR-DEC-001`, `AUR-DEC-011`, `AUR-DEC-012`; ADR 0006, ADR 0008, ADR 0009
- Owners: maintainer / release, security, DevEx, and architecture reviewers

## Context

AuroraFlow now has hardened pull-request security, semantic required checks, SHA-pinned actions, deterministic installs, release dry-run consumer validation, mutation/schema strictness, and strict observability receipt evidence. The remaining CI/CD maturity items from the implementation plan are useful only when measured evidence or explicit maintainer approval exists.

The project is still one public TypeScript npm library. It does not ship a container image, own a Kubernetes deployment, run database migrations, provide a hosted service, or operate hosted observability/SAT infrastructure. Release publishing remains disabled.

## Decision

Phase 6 maturity work is advisory or deferred:

1. **Advisory security telemetry.** harden-runner, OpenSSF Scorecard, optional license checks, and Playwright blob reporting may collect scheduled or manual evidence, but they must not become required checks without a successor ADR and measured noise/cost data. harden-runner starts audit-only. OpenSSF Scorecard must record a measured score before any threshold is proposed; guessed thresholds are forbidden.
2. **Governance remains operable for a single maintainer.** Do not enable mandatory code-owner review, mandatory signed commits, merge queue, or branch/ruleset rewrites that could deadlock the maintainer. Code-owner review requires a confirmed second maintainer or replacement owner route. Merge queue requires every required workflow to support `merge_group` before enablement.
3. **Publish remains disabled.** No npm publish job, no `id-token: write` publish permission, and no `NPM_TOKEN` may be added under this decision. A future publish path requires an explicit maintainer release decision, a protected `release` environment, npm trusted publisher configuration for this exact repository/workflow/environment, and same-commit Quality/Security evidence green before publish.
4. **Library scope stays bounded.** No container image scanning, Kubernetes/deploy gates, database migration gates, hosted SAT, hosted observability, service deployment controls, or multi-package release system are authorized until product evidence changes the scope through a successor ADR.
5. **Topology and trust boundaries stay stable.** Keep the six-workflow topology and existing read-only/default permission posture unless a successor ADR records why an additional workflow or permission boundary is safer.

## Consequences

The hardened CI/CD foundation remains strict where it protects current users: pull requests, package consumers, release dry-run evidence, CodeQL/security gates, Node 20/22/24 compatibility, Redis-required integration, critical coverage, and observability receipts. Optional maturity signals can still be measured without accidentally expanding the product, blocking a single maintainer, or creating a publish path.

The cost is that Scorecard thresholds, hard egress blocking, merge queue, signed commits, and real npm publishing remain unavailable until maintainers provide the missing evidence and approvals.

## Revisit triggers

Record a successor ADR before changing this decision. Valid triggers are:

- two weeks of clean advisory harden-runner evidence plus a maintained egress allowlist;
- measured OpenSSF Scorecard output and an explicit maintainer-approved threshold proposal;
- confirmed second-maintainer or owner-route capacity for mandatory code-owner review;
- higher PR volume that justifies merge queue, after all required workflows include `merge_group`;
- explicit first-publish approval with release owner, protected environment, npm trusted publisher, and rollback owner;
- product evidence that AuroraFlow now ships a container, owns a deployed service, manages database migrations, or needs multiple published packages.
