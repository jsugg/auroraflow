# Contributing

AuroraFlow keeps contribution process lightweight: small scoped changes, source-backed docs, and targeted validation. Use this guide for local setup, review expectations, and architecture-governance touchpoints.

## Quick start

1. Read the project overview in [`README.md`](README.md) and local workflow details in [`docs/development.md`](docs/development.md).
2. Install dependencies:

   ```bash
   npm ci
   npx playwright install --with-deps
   ```

3. Create a focused branch:

   ```bash
   git switch -c feature/<short-topic>
   ```

4. Make the smallest coherent change and run the relevant validation below.

## Scope and review rules

- Prefer one subsystem per pull request.
- Keep production behavior, docs, tests, and contracts aligned.
- Do not remove or rename public root exports without the API-tier process in [`docs/api-stability.md`](docs/api-stability.md).
- Do not add dependencies, generated files, lockfile changes, release credentials, or infrastructure ownership claims unless the active task explicitly requires them.
- Do not broaden self-healing, Redis, telemetry, privacy, or release behavior from "planned" to "implemented" in docs unless source and tests already support the claim.

For architecture-roadmap tasks, update the implementation journal in [`docs/ARCHITECTURE_IMPLEMENTATION_PLAN.md`](docs/ARCHITECTURE_IMPLEMENTATION_PLAN.md) before work starts, after meaningful changes, after validation, and before handoff.

## Validation matrix

Run the narrowest useful gate first, then the broader gate that matches your change.

| Change area | Minimum validation |
| --- | --- |
| Markdown/docs only | `npm run format:check` and `npm run test:contracts -- tests/suites/contracts/docs/documentationSurface.contract.spec.ts` |
| TypeScript source | Targeted unit/integration tests, `npm run typecheck`, `npm run lint`, `npm run format:check` |
| Public API surface | Package-surface unit and contract tests plus `npm run typecheck` |
| JSON Schemas | `npm run schemas:check` and affected contract tests |
| Workflows | `npm run workflows:lint` and `npm run workflows:security` |
| Redis data paths | Store/unit tests plus Redis integration when Docker is available |
| Observability paths | Focused observability tests; use full-stack smoke only when the task requires it |
| Release process | Release workflow contracts, `npm run build`, and `npm run pack:dry-run` |

Before merging broad changes, prefer `npm run verify` when local tooling and time permit. `npm test` is unit-only; run `test:contracts` and `test:integration` explicitly when the change touches contracts or Redis/OTLP paths.

## Safety guardrails

Self-healing changes must preserve the safety-first contract:

- `SELF_HEAL_MODE=off` remains the default.
- Guarded mode remains policy-gated and dry-run validated.
- Any auto-apply path gets at most one guarded retry and must not hide the original failure if retry fails.
- Source-code rewrites and blind selector mutation remain out of scope.
- Shared selector promotion requires explicit policy and protected-review workflow before active selector mutation.

Privacy-sensitive data includes screenshots, DOM text, URLs, selectors, logs, telemetry attributes, Redis records, trend files, and audit records. Keep artifact controls and retention guidance aligned with [`docs/operations/privacy-retention.md`](docs/operations/privacy-retention.md).

## Ownership and advisory review

The repository uses an advisory CODEOWNERS file at [`.github/CODEOWNERS`](.github/CODEOWNERS). It maps critical paths to the current maintainer handle (`@jsugg`) for review routing and bus-factor visibility.

The map is advisory until branch protection explicitly requires code-owner review. Confirm or replace owner handles with the maintainer before enabling enforcement, and add team aliases where available.

Critical areas that should receive owner review:

- self-healing and promotion safety;
- API tiers and root exports;
- scoring/SLO policy;
- Redis selector registry and data retention;
- observability contracts and support boundaries;
- release workflow, SBOM, provenance, and rollback policy;
- privacy, secrets, and artifact retention.

## Architecture decision records

Use ADRs for durable decisions that change policy, compatibility, operational boundaries, or safety behavior. Do not use ADRs for routine implementation notes.

Initial ADRs live in [`docs/adr/`](docs/adr/):

- [ADR 0001: Safety-first self-healing](docs/adr/0001-safety-first-self-healing.md)
- [ADR 0002: API stability tiers](docs/adr/0002-api-stability-tiers.md)
- [ADR 0003: Scoring and SLO policy](docs/adr/0003-scoring-and-slo-policy.md)
- [ADR 0004: Redis strategy](docs/adr/0004-redis-strategy.md)
- [ADR 0005: Observability boundary](docs/adr/0005-observability-boundary.md)
- [ADR 0006: Release policy](docs/adr/0006-release-policy.md)

Each ADR should state status, date, context, decision, consequences, related `AUR-ARCH-*` issues, and revisit triggers.

## Security and disclosure

Do not commit secrets, credentials, real user data, or production screenshots. Use synthetic fixtures in tests. If you suspect a secret or sensitive artifact was committed, stop normal work and coordinate private remediation with the maintainer before opening a public pull request.
