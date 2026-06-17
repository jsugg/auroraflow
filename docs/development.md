# Development Guide

This guide is for contributors and maintainers working in the AuroraFlow repository. The README is the project overview; this file covers local setup, verification, source layout, and the maturity boundaries to keep in mind while making changes.

## Development stance

AuroraFlow documentation should describe implemented behavior first and roadmap behavior second. If a feature is not backed by source, tests, scripts, or workflow configuration, call it planned rather than current.

Important current boundaries:

- Self-healing SAT is diagnostic and guarded; it does not blindly or autonomously update selectors.
- `SELF_HEAL_REGISTRY_MODE=read` can load active selector records and candidate history when a registry runtime is configured.
- `SELF_HEAL_REGISTRY_MODE=write_pending` can persist SAT history observations and reviewable pending promotion records.
- Reviewed approve, reject, conflict, and rollback workflows mutate selector registry records only; they do not rewrite source files.
- The observability stack is suitable for local development and CI smoke validation. Production deployment requires environment-owned credentials, TLS, storage, retention, network policy, and operations support.
- The package build emits `src/**/*.ts` declarations and JavaScript into `dist`; the package also includes curated `docs/` and `schemas/`.

## Prerequisites

- Node.js `>=20 <25`
- npm
- Docker, for Redis/Testcontainers integration tests and the local observability stack
- Playwright browsers, for smoke, examples, and E2E tests
- ShellCheck and actionlint, when running the same workflow linting locally as CI

Install dependencies and browser binaries:

```bash
npm ci
npx playwright install --with-deps
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Root package export surface. |
| `src/pageObjects/pageObjectBase.ts` | Base page action wrapper, screenshots, self-healing failure path, and page action telemetry. |
| `src/helpers/pageFactory.ts` | Page object instance cache. |
| `src/framework/selfHealing/` | Configuration, DOM snapshots, candidate extraction/scoring, failure artifacts, guarded validation, and artifact schemas. |
| `src/data/selectors/selectorRegistry.ts` | Typed selector registry repository over a Redis-compatible store contract. |
| `src/utils/redisClient.ts` | Redis runtime configuration, connection lifecycle, namespacing, retries, and key scanning. |
| `src/framework/observability/` | No-op/default telemetry facade, OpenTelemetry adapter, attribute builders, flakiness reports, SLO dashboards, and alert evaluation. |
| `src/utils/logger.ts` | Structured logging configuration and redaction defaults. |
| `tests/suites/unit/` | Fast unit tests. |
| `tests/suites/contracts/` | Package, workflow, infrastructure, documentation, and schema-adjacent contracts. |
| `tests/suites/integration/` | Redis/Testcontainers and OTLP integration coverage. |
| `tests/suites/e2e/examples/` | Playwright-backed example and smoke scenarios. |
| `.github/workflows/` | Quality, examples, security, and E2E matrix workflows. |
| `observability/` | Local stack configuration and reference production manifests. |

## Common commands

### Quality gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:unit
npm run test:contracts
npm run test:integration
npm run schemas:check
npm run build
```

Run the repository verification target:

```bash
npm run verify
```

`npm test` is the unit-only fast path. It uses Vitest's thread pool without per-file isolation and must not require browsers, Docker, Redis, or an OTLP collector.

`npm run test:contracts` validates package, workflow, infrastructure, and documentation contracts without Redis/Testcontainers or browser setup.

`npm run test:integration` is reserved for real integration coverage (Redis/Testcontainers and OTLP export). Use `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true npm run test:integration` when Redis evidence must block instead of skip. Set `AURORAFLOW_REDIS_INTEGRATION_EXTERNAL=true` with `AURORAFLOW_REDIS_*` connection settings to reuse an already-running Redis instead of starting the default Testcontainers Redis instance.

`npm run verify` runs repo-local actionlint bootstrap, formatting, linting, typechecking, unit tests, contracts, Redis/OTLP integration, schema validation, ShellCheck, and workflow linting.

| Command | Cost tier | Scope |
| --- | --- | --- |
| `npm test` / `npm run test:unit` | Fast local | Unit tests only; thread pool without per-file isolation; no browser, Docker, Redis, or OTLP dependency. |
| `npm run test:contracts` | Static/contract | Package, workflow, infrastructure, and docs contracts. |
| `npm run test:integration` | Real integration | Redis/Testcontainers and OTLP export. |
| `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true npm run test:integration` | Blocking real integration | Same Redis/OTLP integration suite, but Redis startup/connect failures fail instead of skip. |
| `npm run test:coverage` | Coverage | Critical-module thresholds plus global `src/**` coverage. |
| `npm run test:e2e` | Browser | Playwright browser projects. |
| `npm run test:e2e:guarded` | Guarded browser proof | Parallel Chrome proof for guarded self-heal at the default gate. |
| `npm run verify` | Full local gate | Static checks, unit, contracts, integration, schemas, ShellCheck, and workflow lint. |

### CI gate topology

| Gate | Cost tier | Runs | Responsibility |
| --- | --- | --- | --- |
| `Node Compatibility (Node 20/22/24)` | Fast matrix | Pull requests, `main`, scheduled, and manual quality workflow runs | `npm ci`, lint, typecheck, and unit tests only; no Docker, Redis, OTLP collector, or browser install. |
| `Repository Gates (Node 22)` | Static + Docker integration | Pull requests, `main`, scheduled, and manual quality workflow runs | Format, contracts, Redis/OTLP integration with `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true`, schemas, ShellCheck, and workflow lint. |
| `Coverage (Critical + Global)` | Coverage | Pull requests, `main`, scheduled, and manual quality workflow runs | Enforces critical-module thresholds and global `src/**` coverage once on Node 22. Risk-weighted coverage floors remain future QE-2 work. |
| `Guarded Self-Heal Proof (Chrome)` | Guarded browser proof | Pull requests, `main`, scheduled, and manual quality workflow runs | Preserves Chrome proof for guarded self-heal at the shipped default confidence gate. |
| `Risk-Triggered E2E (Chrome)` | Browser heavy | `main`, scheduled/manual runs, risky browser/runtime paths, or `full-e2e`/`risk:e2e` PR labels | Runs the full Chrome E2E project outside the Node compatibility matrix. |
| Observability smoke jobs | Docker/remote optional | Path-triggered, `main`, scheduled, or manual runs depending on the job | Keeps collector/full-stack/remote export evidence separate from fast compatibility gates. |

### Browser suites

```bash
npm run test:smoke
npm run test:examples
npm run test:e2e
```

The full E2E workflow shards across desktop and mobile browser projects on `main`, schedule, and manual dispatch. The quality workflow also has a risk-triggered full Chrome E2E lane for risky browser/runtime paths or `full-e2e`/`risk:e2e` PR labels. Pull-request smoke and examples lanes remain path-filtered by workflow configuration.

If a constrained local machine times out during accessibility smoke checks, reproduce with a larger Playwright timeout before changing source:

```bash
npx playwright test --config=configs/playwright.config.ts \
  --project='Google Chrome' \
  --grep @smoke \
  --timeout=60000 \
  --workers=1
```

### Package surface

```bash
npm run build
npm run pack:dry-run
```

`tsconfig.build.json` uses `src` as the root and excludes tests, examples, and scripts. Package contracts expect `dist`, `docs`, `schemas`, `README.md`, and `LICENSE` as the packaged files.

## Redis development

Integration tests use Testcontainers and an ephemeral `redis:7.2-alpine` container when Docker is available. For iterative local debugging, start the repository Redis service:

```bash
npm run infra:redis:up
npm run test:integration
npm run infra:redis:logs
npm run infra:redis:down
```

Default local Redis behavior is skip-friendly: if Docker/Testcontainers cannot start Redis, the Redis integration spec reports an explicit skip so non-Redis contributors are not blocked. Required mode is blocking: `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true npm run test:integration` fails on Redis startup, connection, or evidence failures and is the CI/release mode used by `Repository Gates (Node 22)` and the release dry-run. External mode is opt-in: `AURORAFLOW_REDIS_INTEGRATION_EXTERNAL=true AURORAFLOW_REDIS_HOST=127.0.0.1 AURORAFLOW_REDIS_PORT=6379 npm run test:integration` reuses an existing Redis with a per-run key prefix.

Keep selector registry changes aligned with:

- `src/data/selectors/selectorRegistry.ts`
- `src/utils/redisClient.ts`
- `docs/architecture/data-layer.md`
- `tests/suites/integration/framework/data/redisIntegration.spec.ts`

## Self-healing development

Supported runtime modes:

- `SELF_HEAL_MODE=off`
- `SELF_HEAL_MODE=suggest`
- `SELF_HEAL_MODE=guarded`

Useful commands:

```bash
SELF_HEAL_MODE=suggest npm run test:smoke
SELF_HEAL_MODE=guarded npm run test:smoke
npm run self-heal:governance
```

Artifacts are written to `SELF_HEAL_ARTIFACTS_DIR` when set, otherwise `test-results/self-healing/*.json`; governance summaries are written to `test-results/self-healing-governance-summary.{json,md}`.

When extending this area, keep these contracts intact:

- DOM capture must stay bounded and redacted.
- Guarded validation must remain policy-gated.
- Auto-apply must not suppress a failed retry.
- Promotion or registry writes need explicit tests, documentation, and review controls before being claimed as current behavior.

## Observability development

Telemetry is disabled by default. Enable it explicitly:

```bash
npm run observability:up

AURORAFLOW_OBSERVABILITY_ENABLED=true \
AURORAFLOW_OBSERVABILITY_ENVIRONMENT=local \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm run observability:smoke

npm run observability:snapshot
npm run observability:down
```

Keep observability changes aligned with:

- `docs/operations/observability-contract.md`
- `docs/architecture/observability-stack.md`
- `observability/README.md`
- `tests/suites/contracts/observability/observabilityContract.spec.ts`

The JSON/Markdown flakiness, SLO, and alert artifacts remain the deterministic merge-gate source. Local dashboards and alert rules are useful development assets, but production use should go through the dashboard review checklist and emitted-label validation.

## Workflow and security checks

CI installs native `actionlint` before running `npm run verify`. For the closest local match, install `actionlint` and `shellcheck` before running:

```bash
npm run workflows:lint
npm run shellcheck
npm run security:check
```

Security workflows cover dependency review on pull requests, high-severity npm audit on non-PR events, CodeQL on non-PR events, gitleaks, workflow security scanning, and a final security gate.

## Release process

Releases are governed by a manual, dry-run-only workflow (`.github/workflows/release.yml`) that produces auditable evidence — pack report, SPDX/CycloneDX SBOMs, provenance-readiness check, and a changelog draft — without publishing. Publishing is intentionally disabled behind a protected-environment placeholder. See [release-process.md](operations/release-process.md) for the changelog, rollback, provenance, and SBOM policy (`AUR-DEC-012`).

## Contribution governance

Use [`../CONTRIBUTING.md`](../CONTRIBUTING.md) as the lightweight contributor entry point. It links the validation matrix, safety guardrails, advisory CODEOWNERS policy, and initial ADR set.

Ownership is advisory by default: [`.github/CODEOWNERS`](../.github/CODEOWNERS) routes review to the current maintainer handle, but it becomes enforceable only if branch protection requires code-owner review. Confirm or replace owner handles with the maintainer before enabling that enforcement.

Architecture decision records live in [`adr/`](adr/). Add or supersede an ADR when a change affects safety-first self-healing, API compatibility tiers, scoring/SLO policy, Redis ownership, observability support boundaries, release policy, or another durable architecture decision.

## Documentation rules

Documentation should remain precise and source-backed:

- Prefer "implemented", "available", or "enabled by" only for behavior present in source.
- Prefer "planned", "reference", or "roadmap" for future services, deployments, or automation.
- Lifecycle docs must keep `closeAuroraFlow(context?)` and `auroraflow/playwright` labeled as planned until `AUR-IMPL-023` source and tests land.
- Link to the source-owning architecture or operations document when a README section would otherwise become too detailed.
- Keep production observability wording clear: local assets and reference manifests are not environment ownership.

## Troubleshooting

- **Redis integration skipped:** confirm Docker is running. The integration suite should skip explicitly rather than hang when Testcontainers cannot start.
- **Workflow lint differs locally:** install native `actionlint`; CI does this before `npm run verify`.
- **No live telemetry:** confirm `AURORAFLOW_OBSERVABILITY_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
- **Grafana has no metrics:** check Prometheus targets at <http://localhost:9090/targets> and Collector health at <http://localhost:13133>.
- **Self-healing artifacts missing:** confirm `SELF_HEAL_MODE` is `suggest` or `guarded`; `off` is the default.
