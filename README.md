# AuroraFlow

[![Quality Gates](https://github.com/jsugg/auroraflow/actions/workflows/quality.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/quality.yml) [![Examples](https://github.com/jsugg/auroraflow/actions/workflows/examples.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/examples.yml) [![Security Checks](https://github.com/jsugg/auroraflow/actions/workflows/security.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/security.yml) [![E2E Matrix](https://github.com/jsugg/auroraflow/actions/workflows/ci.yml/badge.svg)](https://github.com/jsugg/auroraflow/actions/workflows/ci.yml)

![AuroraFlow Logo](https://github.com/jsugg/auroraflow/blob/main/.github/assets/auroraflow-logo.png?raw=true)

AuroraFlow is a TypeScript Playwright automation framework focused on maintainable page objects, mode-gated self-healing diagnostics, Redis-backed selector/data primitives, and deterministic CI observability artifacts.

The project is intentionally explicit about what is production-ready foundation versus what is still a roadmap item. The current package ships framework primitives from `src/`; examples, tests, scripts, and operations assets remain repository tooling.

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

- Autonomous selector promotion or source-code rewrites.
- Runtime SAT history loading from Redis or persistent promotion writes.
- A Dockerized SAT service or a Dockerized framework service.
- Production-owned observability deployment; production manifests are references that require environment-specific ownership, credentials, storage, DNS, TLS, and network controls.

## Feature maturity

| Area | What is mature now | Current boundary | Source |
| --- | --- | --- | --- |
| Package surface | Root package metadata, declaration output, curated publish files, and broad typed exports are contract-tested. | The published artifact is limited to `dist`, `README.md`, and `LICENSE`; repository examples and scripts are not part of the package API. | `package.json`, `src/index.ts`, `tsconfig.build.json`, `tests/suites/contracts/package/packageSurface.contract.spec.ts` |
| Page objects | `PageObjectBase` wraps navigation, click, type, read, wait, screenshot, and close actions with initialization, logging, screenshots, self-healing analysis, and telemetry metrics. `PageFactory` caches page object instances. | Protected helpers that call Playwright directly should be reviewed before treating them as instrumented public actions. | `src/pageObjects/pageObjectBase.ts`, `src/helpers/pageFactory.ts` |
| Self-healing diagnostics | `off`, `suggest`, and `guarded` modes are parsed and enforced. Failure capture can include ranked suggestions, DOM-derived candidates, guarded validation, and one guarded retry for click/type/read/wait. | SAT registry and promotion modes are parsed, but runtime analysis still returns an empty history summary and does not write selector registry records. | `src/framework/selfHealing/config.ts`, `src/framework/selfHealing/analyzer.ts`, `src/framework/selfHealing/guardedValidation.ts`, `docs/architecture/self-healing.md` |
| Redis data layer | Runtime config validation, namespaced keys, bounded retry with jitter, SCAN-based listing, batched reads, selector record validation, and Testcontainers integration coverage are implemented. | Redis is not yet wired into SAT history scoring or promotion workflows. | `src/utils/redisClient.ts`, `src/data/selectors/selectorRegistry.ts`, `docs/architecture/data-layer.md` |
| Observability | The telemetry facade is no-op by default, can export OpenTelemetry spans/metrics when enabled, and keeps JSON/Markdown report artifacts as deterministic merge-gate evidence. Local Collector, Prometheus, Grafana, Jaeger, Elasticsearch, Logstash, and Kibana configuration exists. | Dashboards and alert rules are starter operational assets; review their query semantics against emitted attributes before using them as production SLO sources. | `src/framework/observability/*`, `docs/operations/observability-contract.md`, `docs/architecture/observability-stack.md`, `observability/README.md` |
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

Guarded mode is intentionally conservative. It evaluates locator candidates in dry-run mode and can retry supported actions once when a candidate is policy-allowed and confidence-eligible. It does not promote selectors into Redis, update source code, or maintain SAT history today.

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

See [`docs/architecture/data-layer.md`](docs/architecture/data-layer.md).

## Observability

Live telemetry is opt-in. Without `AURORAFLOW_OBSERVABILITY_ENABLED=true`, the telemetry facade stays no-op and report artifacts remain the primary evidence source.

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
  framework/selfHealing/   Failure capture, DOM snapshots, candidate scoring, guarded validation
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

- [Development guide](docs/development.md)
- [Self-healing foundation](docs/architecture/self-healing.md)
- [Data layer foundation](docs/architecture/data-layer.md)
- [Observability stack architecture](docs/architecture/observability-stack.md)
- [Observability contract](docs/operations/observability-contract.md)
- [Artifact schemas](docs/operations/artifact-schemas.md)
- [SLO dashboard and alerting](docs/operations/slo-dashboard-alerting.md)
- [Security and secrets](docs/operations/security-secrets.md)
- [Examples](examples/README.md)

## Roadmap

The next meaningful maturity steps are:

1. Wire SAT analysis to selector registry history and reviewed promotion workflows.
2. Add promotion governance that records pending selector changes without mutating application tests silently.
3. Harden live dashboard and alert query semantics against emitted metric attributes.
4. Continue expanding package-surface contracts and example coverage before widening the public API.

## Contributing

Contributions are welcome when they preserve the repository's current-state framing: implemented features should be described as implemented, and roadmap items should stay clearly marked until corresponding source, tests, and workflows exist.

Before opening a pull request, run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

See [`docs/development.md`](docs/development.md) for workflow details and local troubleshooting.

## License

MIT
