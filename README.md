# AuroraFlow

[![Quality Gates](https://github.com/jsugg/auroraflow/actions/workflows/quality.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/quality.yml) [![Examples](https://github.com/jsugg/auroraflow/actions/workflows/examples.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/examples.yml) [![Security Checks](https://github.com/jsugg/auroraflow/actions/workflows/security.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/security.yml) [![E2E Matrix](https://github.com/jsugg/auroraflow/actions/workflows/ci.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/ci.yml)

![AuroraFlow Logo](https://github.com/jsugg/auroraflow/blob/main/.github/assets/auroraflow-logo.png?raw=true)

AuroraFlow is a TypeScript Playwright automation framework focused on maintainable page objects, mode-gated self-healing diagnostics, Redis-backed selector/data primitives, and deterministic CI observability artifacts.

The project is intentionally explicit about what is production-ready foundation versus what is still a roadmap item. The current package ships built framework primitives, curated docs, JSON Schemas, the README, and the license; examples, tests, scripts, workflow files, and observability stack assets remain repository tooling.

## Current status

AuroraFlow is a serious framework foundation, not a complete autonomous testing platform. The implementation currently includes:

- Playwright page object and page factory primitives with typed public exports.
- Page action wrappers that emit logs, screenshots, self-healing artifacts, and optional telemetry.
- Mode-gated self-healing diagnostics with bounded DOM snapshots, deterministic candidate scoring, guarded dry-run validation, and a single guarded retry for supported actions.
- Redis configuration/client primitives plus a typed selector registry repository.
- Deterministic flakiness, SLO dashboard, and alert evaluation reports generated from Playwright JSON output.
- Opt-in OpenTelemetry instrumentation and a local collector-backed observability stack.
- CI quality, examples, security, observability smoke, and scheduled E2E matrix workflows.

Not implemented yet:

- Source-code rewrites or blind autonomous selector mutation.
- A Dockerized SAT service or a Dockerized framework service.
- Production-owned observability deployment; production manifests are references that require environment-specific ownership, credentials, storage, DNS, TLS, and network controls.

## Feature maturity

| Area | What is mature now | Current boundary | Source |
| --- | --- | --- | --- |
| Package surface | Root package metadata, declaration output, curated publish files, broad typed exports, API docs, operations docs, and artifact schemas are contract-tested. | Repository examples, tests, scripts, workflow files, and observability stack assets are not part of the package API. | `package.json`, `src/index.ts`, `tsconfig.build.json`, `tests/suites/contracts/package/packageSurface.contract.spec.ts` |
| Page objects | `PageObjectBase` wraps navigation, click, type, read, wait, screenshot, and close actions with initialization, logging, screenshots, self-healing analysis, and telemetry metrics. `PageFactory` caches page object instances. | Protected helpers that call Playwright directly should be reviewed before treating them as instrumented public actions. | `src/pageObjects/pageObjectBase.ts`, `src/helpers/pageFactory.ts` |
| Self-healing diagnostics | `off`, `suggest`, and `guarded` modes are parsed and enforced. Invalid `SELF_HEAL_*` values warn with the applied fallback by default and throw in opt-in strict mode (`AURORAFLOW_CONFIG_STRICT=true`); diagnostics never echo received values. Failure capture can include ranked suggestions, DOM-derived candidates, registry-backed history, guarded validation, one guarded retry for click/type/read/wait, history observations, reviewable pending promotion records, and audited approve/reject/rollback workflows. | Reviewed promotion scope is registry mutation only; no source-code rewrites or blind unreviewed selector mutation occur. | `src/framework/selfHealing/config.ts`, `src/framework/selfHealing/analyzer.ts`, `src/framework/selfHealing/guardedValidation.ts`, `src/framework/selfHealing/promotionWorkflow.ts`, `docs/architecture/self-healing.md` |
| Redis data layer | Runtime config validation, namespaced keys, bounded retry with jitter, SCAN-based listing, batched reads, selector record validation, CAS, page/action indexes, TTL-capable stores, SAT history records, pending promotions, audited selector updates, Testcontainers coverage, and operator-owned production runbook guidance are implemented. | Redis remains consumer/operator-owned; prefixes are namespace hygiene, not authorization. | `src/utils/redisClient.ts`, `src/data/selectors/selectorRegistry.ts`, `docs/architecture/data-layer.md`, `docs/operations/redis-production-runbook.md` |
| Observability | Artifact-only/no-op is the supported default. Opt-in Lite collector smoke is best effort; the Full local stack and production manifests are reference-only. Dashboard and alert labels are asserted against live Prometheus label/series/query/rule snapshots. | Live telemetry is never enabled implicitly. Shared or production deployment remains consumer/operator-owned and requires credentials, storage, DNS, TLS, capacity, retention, and network controls. | `src/framework/observability/*`, `docs/operations/observability-support-tiers.md`, `docs/operations/observability-contract.md`, `docs/architecture/observability-stack.md`, `observability/README.md` |
| CI and security | Pull requests run quality and security gates. Example and smoke lanes are path-filtered. The full E2E matrix runs on `main`, schedule, and manual dispatch. | Some optional observability and remote-export paths need repository variables/secrets and enough runner capacity. | `.github/workflows/quality.yml`, `.github/workflows/examples.yml`, `.github/workflows/security.yml`, `.github/workflows/ci.yml` |

## Getting started

### Requirements

- Node.js `>=20 <25`
- npm
- Playwright browsers for browser tests
- Docker, when running Redis integration tests or the local observability stack

### Repository setup

```bash
git clone https://github.com/jsugg/auroraflow.git
cd auroraflow
npm ci
npx playwright install --with-deps
npm run verify
```

Run the smoke suite:

```bash
npm run test:smoke
```

Run the examples suite:

```bash
npm run test:examples
```

Build the package surface:

```bash
npm run build
npm run pack:dry-run
```

## Minimal page object example

```ts
import type { Page } from 'playwright';
import { PageFactory, PageObjectBase } from 'auroraflow';

class LoginPage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
    this.url = 'https://example.test/login';
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.open();
    await this.type('[data-testid="email"]', email);
    await this.type('[data-testid="password"]', password);
    await this.click('[data-testid="submit"]');
  }
}

const factory = new PageFactory(page);
const loginPage = factory.getPage(LoginPage);
await loginPage.signIn('user@example.test', 'correct-horse-battery-staple');
```

For runnable examples, see [`examples/`](examples/) and `tests/suites/e2e/examples/`.

## Self-healing diagnostics

Self-healing is disabled by default. Enable it only when you want failure artifacts for triage:

```bash
SELF_HEAL_MODE=suggest npm run test:smoke
SELF_HEAL_MODE=guarded SELF_HEAL_ALLOWED_DOMAINS=example.test npm run test:smoke
```

Artifacts are written under `test-results/self-healing/*.json` and can be summarized with:

```bash
npm run self-heal:governance
```

Guarded mode is intentionally conservative. It evaluates locator candidates in dry-run mode and can retry supported actions once when a candidate is policy-allowed and confidence-eligible. With `SELF_HEAL_REGISTRY_MODE=write_pending` and a configured registry, SAT records history observations and pending promotion review records. Reviewed promotions use expected-status CAS; local authorization is permissive with a warning, while shared mode requires CODEOWNERS plus protected workflow evidence. Guarded diagnostics do not mutate active selectors or update source code.

See [`docs/architecture/self-healing.md`](docs/architecture/self-healing.md).

## Redis data layer

Start a local Redis instance:

```bash
npm run infra:redis:up
npm run test:integration
npm run infra:redis:down
```

Core environment variables:

- `AURORAFLOW_REDIS_URL`
- `AURORAFLOW_REDIS_HOST`
- `AURORAFLOW_REDIS_PORT`
- `AURORAFLOW_REDIS_DB`
- `AURORAFLOW_REDIS_USERNAME`
- `AURORAFLOW_REDIS_PASSWORD`
- `AURORAFLOW_REDIS_TLS`
- `AURORAFLOW_REDIS_KEY_PREFIX`

See [`docs/architecture/data-layer.md`](docs/architecture/data-layer.md) and the operator-owned [`Redis production runbook`](docs/operations/redis-production-runbook.md).

## Observability

Live telemetry is opt-in. Without `AURORAFLOW_OBSERVABILITY_ENABLED=true`, the telemetry facade stays no-op and report artifacts remain the primary evidence source.

Support tiers are artifact-only (supported default), Lite collector-only (best effort), and Full local/reference (reference only). Start Lite with `npm run observability:lite:up`; `npm run observability:up` starts the Full stack. Neither command enables application telemetry automatically. See [Observability support tiers](docs/operations/observability-support-tiers.md).

Start the local stack:

```bash
npm run observability:up
```

Emit telemetry to the local Collector:

```bash
AURORAFLOW_OBSERVABILITY_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
npm run test:smoke
```

Assert exported Prometheus labels, dashboard expressions, and alert rules against the local stack:

```bash
npm run observability:live-assert
```

Local tools:

- Grafana: <http://localhost:3000>
- Prometheus: <http://localhost:9090>
- Jaeger: <http://localhost:16686>
- Kibana: <http://localhost:5601>
- Collector health: <http://localhost:13133>

Stop the stack:

```bash
npm run observability:down
```

See [`docs/operations/observability-contract.md`](docs/operations/observability-contract.md), [`docs/architecture/observability-stack.md`](docs/architecture/observability-stack.md), and [`observability/README.md`](observability/README.md).

## Repository map

```text
src/
  data/selectors/          Redis-backed selector registry primitives
  framework/observability/ Telemetry facade, report aggregation, SLO and alert artifacts
  framework/runtime/       Runtime context container, lifecycle/disposer registry, and Playwright test fixture
  framework/selfHealing/   Failure capture, DOM snapshots, candidate scoring, guarded validation, and promotion governance
  helpers/                 Page factory and small utilities
  pageObjects/             Base page object implementation
  utils/                   Logger and Redis client
tests/suites/              Unit, framework, integration, contract, and E2E example suites
docs/                      Architecture, operations, and development documentation
examples/                  Runnable usage examples and CI templates
observability/             Local and reference production observability assets
configs/                   Playwright and quality configuration
scripts/                   Report generation, workflow linting, governance, and smoke helpers
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Writing tests](docs/writing-tests.md)
- [Configuration](docs/configuration.md)
- [API](docs/api.md)
- [Contributing](CONTRIBUTING.md)
- [Development guide](docs/development.md)
- [Architecture decision records](docs/adr/README.md)
- [Architecture decision log](docs/architecture/decision-log.md)
- [Phase 0 validation baseline](docs/architecture/phase-0-validation-baseline.md)
- [Self-healing foundation](docs/architecture/self-healing.md)
- [Data layer foundation](docs/architecture/data-layer.md)
- [Redis production runbook](docs/operations/redis-production-runbook.md)
- [Observability stack architecture](docs/architecture/observability-stack.md)
- [Observability contract](docs/operations/observability-contract.md)
- [Observability support tiers](docs/operations/observability-support-tiers.md)
- [Durable trend export](docs/operations/trend-durable-export.md)
- [Artifact schemas](docs/operations/artifact-schemas.md)
- [SLO dashboard and alerting](docs/operations/slo-dashboard-alerting.md)
- [Security and secrets](docs/operations/security-secrets.md)
- [Examples](examples/README.md)

## Roadmap

The next meaningful maturity steps are:

1. Add richer trend triage views on top of the persisted JSONL history.
2. Continue package-surface contracts and example coverage before widening the public API.
3. Keep production observability guidance aligned with measured Collector and Prometheus behavior.

## Contributing

Contributions are welcome when they preserve the repository's current-state framing: implemented features should be described as implemented, and roadmap items should stay clearly marked until corresponding source, tests, and workflows exist.

Before opening a pull request, run:

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

See [`docs/development.md`](docs/development.md) for workflow details and local troubleshooting.

## License

MIT
