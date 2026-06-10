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
| `tests/suites/framework/` | Framework behavior tests. |
| `tests/suites/integration/` | Redis/Testcontainers integration coverage. |
| `tests/suites/contracts/` | Package, workflow, infrastructure, and documentation contracts. |
| `tests/suites/e2e/examples/` | Playwright-backed example and smoke scenarios. |
| `.github/workflows/` | Quality, examples, security, and E2E matrix workflows. |
| `observability/` | Local stack configuration and reference production manifests. |

## Common commands

### Quality gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

Run the repository verification target:

```bash
npm run verify
```

`npm run verify` runs formatting, linting, typechecking, unit/framework tests, integration/contracts, ShellCheck, and workflow linting.

### Browser suites

```bash
npm run test:smoke
npm run test:examples
npm run test:e2e
```

The full E2E workflow shards across desktop and mobile browser projects on `main`, schedule, and manual dispatch. Pull-request smoke and examples lanes are path-filtered by workflow configuration.

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

Artifacts are written to `test-results/self-healing/*.json`; governance summaries are written to `test-results/self-healing-governance-summary.{json,md}`.

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

## Documentation rules

Documentation should remain precise and source-backed:

- Prefer "implemented", "available", or "enabled by" only for behavior present in source.
- Prefer "planned", "reference", or "roadmap" for future services, deployments, or automation.
- Link to the source-owning architecture or operations document when a README section would otherwise become too detailed.
- Keep production observability wording clear: local assets and reference manifests are not environment ownership.

## Troubleshooting

- **Redis integration skipped:** confirm Docker is running. The integration suite should skip explicitly rather than hang when Testcontainers cannot start.
- **Workflow lint differs locally:** install native `actionlint`; CI does this before `npm run verify`.
- **No live telemetry:** confirm `AURORAFLOW_OBSERVABILITY_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
- **Grafana has no metrics:** check Prometheus targets at <http://localhost:9090/targets> and Collector health at <http://localhost:13133>.
- **Self-healing artifacts missing:** confirm `SELF_HEAL_MODE` is `suggest` or `guarded`; `off` is the default.
