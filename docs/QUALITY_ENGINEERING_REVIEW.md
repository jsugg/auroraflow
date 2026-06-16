# Quality Engineering Review

> **Scope & method.** This document is a Principal-SDET / Staff+ Quality-Engineering due-diligence review of the AuroraFlow repository at branch `main` (latest commit `f9f17b5 docs: add contributor governance`). It is based on direct inspection of source, tests, fixtures, CI workflows, scripts, configs, schemas, and documentation, plus one local execution of the unit suite. Every material claim is tagged **[Observed]** (verified directly in the repo or by running a command), **[Inferred]** (a reasoned conclusion from observed evidence), or **[Unknown]** (cannot be determined from the repository and needs stakeholder input). No production code was modified to produce this review.
>
> **Reviewed artifact counts (all [Observed]):** ~11,717 LOC of TypeScript source across ~43 files; ~11,327 LOC of tests; 41 unit spec files / 237 unit tests (passing locally); 2 integration spec files; 17 contract spec files; 6 e2e spec files; 317 total `it`/`test` blocks; 6 GitHub Actions workflows; 6 ADRs; 10 JSON schemas.

---

## 1. Executive Summary

**Quality maturity: High for a single-maintainer pre-1.0-publication library; notably above typical OSS test-tooling — but with a test _distribution_ problem the aggregate numbers hide.** AuroraFlow is a TypeScript + Playwright test-automation framework whose own _internal_ quality engineering is, where it exists, genuinely well-crafted: a multi-layer test strategy (unit / integration via Testcontainers / contract / e2e), strict TypeScript, secret-redacting structured logging, OpenTelemetry instrumentation with a CI smoke gate, SBOM + provenance-readiness release evidence, and an uncommon **contract-test layer that pins its own CI/docs/infra invariants**. [Observed] The often-cited "~1:1 source-to-test LOC ratio," however, is a **vanity metric**: net of contract-text and infra helpers the effective behavioral ratio is ≈0.82:1, and it is **inverted against risk** — the flagship self-healing code (43% of source) sits at 0.78:1 and observability (29%) at just 0.60:1, both largely outside the coverage gate, while the highest-fidelity band (e2e) carries the thinnest assertion budget in the suite (§6.0). [Observed]

**Overall confidence assessment.** Confidence that _the framework's own libraries behave as specified_ is **high** — the critical modules (self-healing config, guarded validation, Redis client, scoring, trends) are densely and deterministically tested. Confidence that _the headline self-healing auto-apply feature works end-to-end at its shipped default_ is **low-to-moderate**, because that path is only proven at an artificially lowered confidence gate (see §6, §9, §20-R1). [Observed]

**Major strengths (detail in §19).** (1) Multi-layer, mostly-deterministic test pyramid with real-dependency integration via Testcontainers. (2) A self-referential _contract test_ suite that fails the build when CI/security/docs/package invariants drift. (3) Strong supply-chain and CI security posture (SHA-pinned actions, CodeQL, gitleaks, zizmor, dependency-review, least-privilege tokens). (4) First-class observability (OTel metrics/traces, redaction, log/trace correlation, SLO + flakiness trend persistence). (5) Explicit governance: ADRs, a decision log, a documented validation baseline, and safety-first defaults.

**Major risks (detail in §20).** One **master finding** subsumes the rest: **test investment is inverted against risk and fidelity.** The framework's differentiating, highest-severity surfaces are its _least_-tested: self-healing (43% of source) sits at 0.78:1 with 3 of 19 modules coverage-gated; observability (29%) at **0.60:1** with 1 of 15 gated; while the small, conventional modules carry the high ratios (§6.0). The concrete severe symptoms, in priority order: (1) **The flagship behavior is never proven end-to-end** — guarded auto-apply is tested layer-by-layer but never _composed_: apply mechanics only at a lowered `0.3` gate, reachability only in isolation at `0.92`, and zero e2e proof that a heal fires; the product is named for a capability no test demonstrates working. (2) **The core value proposition — real-DOM resilience — is untested at fidelity:** the e2e band is synthetic (`page.setContent`), assertion-starved (17 assertions / 8 tests), and uses **no real fixtures**; a "resilient page object" framework never exercises a non-trivial DOM (shadow DOM, iframes, re-render). (3) **The strongest guarantees are silently skippable:** the Redis atomicity/CAS proofs — the only defense against cross-run selector corruption — live behind a Docker-gated integration suite that _self-skips_ when Testcontainers is absent, so the best evidence can vanish without failing the build. (4) **No evidence the tests catch regressions:** coverage is floored on 5 of ~40 modules, there is no global floor, and there is **no mutation or property testing**, so assertion _catch-rate_ on the risk surface is unmeasured and the calibration-critical scoring math is checked at ~3 hand-picked points, not across input space. _(Secondary, org/productivity-level: single-maintainer bus factor and a ~149s unit loop — real, but not correctness risks and explicitly demoted below the four above.)_

**Release readiness.** For its declared intent — a **dry-run-only, not-yet-published library** (publishing is intentionally disabled per `AUR-DEC-012`) — the repository is **release-ready as an evidence-generating pre-release**. It is **not yet ready to publish a `1.x` with the self-healing auto-apply feature advertised as production-grade** until that path has an end-to-end test at the real default gate and a documented activation story. [Observed/Inferred]

**Highest-leverage improvements (all attack the master finding — redirect effort to risk, do not add platform scope).** (1) **Compose the flagship into one end-to-end proof:** seed a high-confidence registry record and drive `PageObjectBase.click` to a _successful guarded auto-heal at the shipped `0.92` gate_ against a realistic DOM fixture — this single test closes risks (1) and starts (2). (2) **Build a real-fixture e2e layer** (a version-pinned fixture app with shadow DOM / iframes / dynamic re-render, behind a proper fixture/page-object harness the repo currently lacks) and move recovery scenarios onto it. (3) **Make the data-integrity proof mandatory:** run the Testcontainers Redis suite as a _required_ CI job that fails — not skips — on `main`, so atomicity is always verified. (4) **Add a global coverage floor _plus mutation testing on the self-healing and data surfaces_** so both branch coverage and assertion catch-rate are measured where risk lives. _Freeze new observability/platform machinery until (1)–(4) land — the issue is mis-allocation, and the fix is redirection, not expansion._ **All four are test-only** (`tests/**`, config, CI) — they need no `src/` change and no new product functionality, they **extend the just-completed Phase 1 assets** (`AUR-IMPL-013` fixtures, `AUR-IMPL-015` coverage/property framework), and they are deliberately bounded **not to preempt Phase 2's** codebase refactors (`AuroraFlowContext`, structured candidates). See the §21 scope banner and the plan-aligned §23 roadmap.

---

## 2. Product Risk Context

**Apparent business purpose.** AuroraFlow is a **reusable test-automation framework / npm library** — "TypeScript Playwright test automation framework with resilient page objects, Redis-backed selector data, self-healing diagnostics, and CI observability artifacts" (`package.json:description`). Its consumers are _other teams' test suites_, not end users. [Observed]

**User impact of failures.** Because the product is a _quality tool_, its failure modes are second-order but high-leverage: [Inferred]

- **False negatives (framework reports pass when the app is broken):** the worst case. The self-healing auto-apply feature is the dominant source of this risk — if it silently swaps a failing locator for a "working" one, a genuine product regression can be masked. The architecture explicitly treats this as the primary hazard (`docs/adr/0001-safety-first-self-healing.md`: "unsafe automation can hide product regressions"). [Observed]
- **False positives / flakiness (framework fails when the app is fine):** erodes trust and wastes triage; the framework ships a flakiness report + SLO dashboard precisely to surface this (`src/framework/observability/flakinessReport.ts`, `scripts/slo-dashboard.ts`). [Observed]
- **Data-layer corruption:** the Redis-backed selector registry/promotion store, if non-atomic, could promote a bad selector across runs; mitigated by Lua `EVAL` compare-and-set and atomic JSON merge (`src/utils/redisClient.ts`). [Observed]

**Critical workflows.** [Observed] (1) Resilient page-object action → failure capture → self-healing analysis → guarded dry-run → optional auto-apply (`src/pageObjects/pageObjectBase.ts`). (2) Selector registry read / candidate-history write / reviewed promotion (`src/framework/selfHealing/*`, `src/data/selectors/*`). (3) Telemetry emission → OTel export → SLO/flakiness aggregation (`src/framework/observability/*`, `scripts/*`).

**Failure-severity categories.** [Inferred] _Critical:_ auto-apply masks a real regression; selector promotion corrupts shared registry. _High:_ coverage gap lets a reliability primitive (retry/backoff/CAS) regress unnoticed. _Medium:_ flaky e2e erodes signal; observability label drift. _Low:_ doc/CI drift (largely caught by the contract suite).

**Risk profile.** [Inferred] The repository's quality investment is **deliberately concentrated on the highest-severity surfaces** (self-healing safety policy, data atomicity, config validation, observability truth). The mismatch is at the _integration altitude_: the riskiest feature is well unit-tested but under-tested end-to-end.

**Unknowns.** Production scale, real consumer count, adoption stage, and whether any downstream suite already depends on auto-apply are **[Unknown]** — there is no telemetry of real usage in-repo.

---

## 3. Repository Quality Map

### 3.1 Test topology at a glance (all [Observed])

```
tests/
├── suites/
│   ├── unit/                                41 spec files · 237 tests · node env · ~149s wall (measured)
│   │   ├── framework/                       (37 specs)  — the framework under test
│   │   │   ├── selfHealing/   (16 specs)    analyzer, candidateScoring, config, domCandidateExtraction,
│   │   │   │                                domSnapshot, failureCapture, guardedValidation, historyRepository,
│   │   │   │                                promotionWorkflow, registryPersistence, registryRuntime,
│   │   │   │                                artifactSchema, artifactJsonSchemas, suggestionEngine, governance
│   │   │   ├── observability/ (12 specs)    telemetry, trends, flakinessReport, sloDashboard, alertPolicies,
│   │   │   │                                reportTelemetry, backendSnapshot, correlation, liveExportAssert,
│   │   │   │                                artifactJsonSchemas + capturingTelemetry.ts (shared fake)
│   │   │   ├── data/          (3 specs)     redisClient, selectorRegistry, memorySelectorStore
│   │   │   ├── pageObjectBase/(3 specs)     error-propagation, self-healing, telemetry
│   │   │   ├── helpers/ logger/ pageFactory/ publicApi/ packageSurface/ (1 spec each)
│   │   └── examples/                        (4 specs)  — consumer-facing example code (dataProviders, ExamplePage,
│   │                                        otelInstrumentation, structuredLogCorrelation)
│   ├── integration/                         2 specs · real Redis (Testcontainers) + real OTLP collector
│   ├── contracts/                           17 specs · invariants over CI / docs / package / infra / observability
│   │   └── workflows/(12) observability/(1) package/(1) docs/(1) infrastructure/(1)
│   └── e2e/examples/                        6 specs · Playwright × 6 browsers · page.setContent fixtures
├── fixtures/privacy/syntheticSecrets.ts     single SYNTHETIC_SECRET constant (no real secrets in tree)
└── helpers/
    ├── selectorStoreConformance.ts          parameterized suite reused by memory + Redis stores
    └── apiStabilitySurface.ts               TypeScript-compiler-API export extractor + manifest parser
```

### 3.2 Module-to-spec map — coverage _by existence_ (sampled across all 43 src files) [Observed]

Almost every non-trivial source module has at least one dedicated spec. The mapping below is the real signal of where verification attention went:

| Source module (LOC) | Dedicated spec(s) | Depth |
| --- | --- | --- |
| `pageObjects/pageObjectBase.ts` (687) | `pageObjectBase.spec` + `…SelfHealing.spec` + `…Telemetry.spec` (3 files) | Heavy — error propagation, init concurrency, self-heal orchestration, telemetry |
| `utils/redisClient.ts` (864) | `data/redisClient.spec` (unit, FakeDriver) + `integration/redisIntegration.spec` (real Redis) | Heavy — retry/telemetry unit + CAS/atomicity integration |
| `data/selectors/selectorRegistry.ts` (567) | `data/selectorRegistry.spec` + conformance + integration | Heavy — CAS, indexes, validation |
| `framework/selfHealing/*` (15 modules) | 16 dedicated specs (1:1+) | Heavy — every module specced |
| `framework/observability/*` (18 modules) | 12 dedicated specs | Medium-heavy |
| `utils/logger.ts` (286) | `logger/logger.spec` | Medium — redaction, config, bindings |
| `helpers/helpers.ts` (retry/wait) | `helpers/retry.spec` | Heavy — backoff/jitter/validation |
| `data/selectors/memorySelectorStore.ts` (281) | `data/memorySelectorStore.spec` + conformance | Medium |
| `index.ts` (public surface) | `publicApi.spec` + `packageSurface.spec` + package contract | Heavy — AST surface lock |
| `framework/observability/otelTelemetry.ts` (206) | only via `integration/otelTelemetryExport.spec` | **Thin — real-export only, Docker-gated** |

**Gap visible in the map:** the OTel _SDK adapter_ (`otelTelemetry.ts`) is only exercised by the Docker-gated integration export test; the in-process default telemetry path is unit-tested through `CapturingTelemetry`, but the real OTLP SDK wiring has no fast unit coverage. [Observed/Inferred]

### 3.3 Test-asset catalog (fixtures, fakes, utilities) [Observed]

This repository uses **hand-built dependency-injection fakes, not a mocking library** — a deliberate choice that keeps tests deterministic and explicit. The reusable assets are:

- **`CapturingTelemetry`** (`unit/framework/observability/capturingTelemetry.ts`) — an in-memory `AuroraFlowTelemetry` implementation recording `spans[]` (with `ok`/`error` status + recorded exceptions), `counters[]`, and `histograms[]`. It models the real span lifecycle (sets `ok` on success, `error` + message on throw). This is the backbone abstraction that lets ~dozen specs assert _exact_ emitted telemetry deterministically. Installed via `setTelemetryForTests` / torn down via `resetTelemetryForTests`.
- **`FakeRedisDriver`** (`data/redisClient.spec.ts`) — a full `RedisClientDriver` implementation (vi.fn-backed `connect`/`quit`/`get`/`set`/`scanIterator`/…) with an `emitError` hook to simulate the driver's `error` event. Enables retry/backoff testing without a network.
- **`defineSelectorStoreConformanceSuite`** (`helpers/selectorStoreConformance.ts`) — a _parameterized_ suite (round-trip, deterministic key listing, TTL expiry + TTL-removal-on-overwrite, invalid-TTL rejection across set/CAS/merge, **sequential + concurrent CAS**, atomic JSON merge counters) that **both** the memory store (fake clock via `advanceTime`) and the Redis store (real `setTimeout`) must pass. One contract, two implementations.
- **`apiStabilitySurface.ts`** — parses `src/index.ts` via the **TypeScript compiler API** (`ts.createSourceFile`) to extract every named export in declaration order, _rejecting_ `export *` to keep the inventory exhaustive, and parses the `docs/api-stability.md` tier table; unknown tier/kind throws.
- **Deterministic micro-fakes** — `createDeferred` (init-concurrency control), `createMemoryDestination` (pino sink capture), env capture/restore maps (self-heal specs), temp-dir fixtures + dynamic `import()` of `scripts/self-healing-governance.mjs` (governance specs).
- **The only data fixture in the tree** is `SYNTHETIC_SECRET` (`fixtures/privacy/syntheticSecrets.ts`) — there are **no recorded HTTP fixtures, no golden files, no seeded databases**; e2e DOM is built inline with `page.setContent(...)`.

### 3.4 Schema catalog → producers (the data-contract layer) [Observed]

10 JSON Schemas in `schemas/` form a contract layer between the framework's emitted artifacts and their consumers (CI governance, dashboards). Each has a producer and a validating spec:

| Schema | Produced by | Validated by |
| --- | --- | --- |
| `self-healing-failure-event` | `failureCapture.ts` | `selfHealing/artifactJsonSchemas.spec`, `artifactSchema.spec` |
| `dom-snapshot` | `domSnapshot.ts` | `artifactSchema.spec` |
| `selector-candidate-history` | `historyRepository.ts` | `artifactSchema.spec`, integration |
| `pending-selector-promotion` | `promotionRepository.ts` | `promotionWorkflow.spec` |
| `self-healing-governance-summary` | `self-healing-governance.mjs` | `selfHealingGovernance.spec` |
| `flakiness-summary` / `slo-dashboard` / `slo-alert-evaluation` | `flakinessReport.ts` / `sloDashboard.ts` / `alertPolicies.ts` | `observability/artifactJsonSchemas.spec` |
| `observability-trend-point` | `trends.ts` | `trends.spec` |

`scripts/schemas-check.ts` (`schemas:check`) validates schema integrity; `_shared.schema.json` holds common `$defs`. This is a genuine producer↔consumer contract layer, not decorative.

### 3.5 Coverage, lint & static-analysis configuration (precise) [Observed]

- **Coverage** (`vitest.config.mts`): provider `v8`; reporters `text` + `json-summary`; `reportsDirectory: coverage`. `coverage.include` lists **exactly five** modules with **per-file** thresholds — `config.ts` 95/95/95/95, `artifactPrivacy.ts` 85/80/95/85, `guardedValidation.ts` 85/75/90/85, `trends.ts` 80/65/90/80, `historyRepository.ts` 75/75/85/75 (statements/branches/functions/lines). **No `src/**`global include and no repo-wide floor** — so the other ~38 modules are *executed* by tests but carry no enforced coverage number. The`test:coverage` script narrows execution to 7 named specs, so the coverage job is a focused critical-module gate, not a whole-suite measurement.
- **Static typing**: `tsconfig.json` `strict: true`, `target: ES2022`, `module: node16`; build config (`tsconfig.build.json`) adds `declaration`, `declarationMap`, `noEmitOnError`. **Zero** `eslint-disable` / `@ts-ignore` / `as any` in `src/` (verified by grep); exactly one tracked `// TODO(AUR-IMPL-020)`.
- **Lint**: ESLint 9 flat config = `eslint.recommended` + `typescript-eslint.recommended` + `@typescript-eslint/no-floating-promises: error` (the one custom rule — significant for an async-heavy codebase) + `eslint-config-prettier`; `projectService: true` enables type-aware linting.
- **Other gates**: Prettier 3 (`format:check`), `tsc --noEmit`, `shellcheck` on `scripts/*.sh`, `actionlint` + `zizmor` on workflows, `vitest clearMocks: true` (auto mock reset between tests).

---

## 4. Quality Technology Stack

| Capability | Tool (version) | Where it appears | Role | Evidence |
| --- | --- | --- | --- | --- |
| Unit / integration / contract tests | **Vitest 4.1.8** | `vitest.config.mts`, `tests/suites/{unit,integration,contracts}` | Primary fast test runner (node env) | [Observed] |
| Coverage | **@vitest/coverage-v8 4.1.8** | `vitest.config.mts`, `test:coverage` | Per-module critical-coverage gate | [Observed] |
| E2E / browser | **Playwright 1.60 / @playwright/test** | `configs/playwright.config.ts`, `tests/suites/e2e` | 6-browser e2e on deterministic pages | [Observed] |
| Real-dependency integration | **Testcontainers 12** (`redis:7.2-alpine`) | `tests/suites/integration/.../redisIntegration.spec.ts` | Spins real Redis for data-layer tests | [Observed] |
| Accessibility | **@axe-core/playwright 4.11** | `tests/suites/e2e/examples/accessibility.spec.ts` | a11y violation assertions | [Observed] |
| Schema / contract validation | **ajv 8 + ajv-formats** | `schemas/`, `scripts/schemas-check.ts`, artifact-schema specs | Validates self-healing & telemetry artifacts | [Observed] |
| Mocking | _No library_ — hand-rolled DI + `CapturingTelemetry` | throughout `tests/` | Deterministic fakes via constructor injection | [Observed] |
| Static typing | **TypeScript 6 (strict)** | `tsconfig.json` | Compile-time correctness | [Observed] |
| Lint | **ESLint 9 + typescript-eslint 8** | `eslint.config.mjs` | Floating-promise + recommended rules | [Observed] |
| Format | **Prettier 3** | `.prettierrc.json`, `format:check` | Style gate | [Observed] |
| Shell lint | **shellcheck** | `shellcheck` script, pre-push, CI | Script safety | [Observed] |
| Workflow lint/security | **actionlint 2 + zizmor** | `workflows:lint`, `workflows:security`, security.yml | CI correctness + supply-chain | [Observed] |
| SAST | **CodeQL (javascript-typescript)** | `.github/workflows/security.yml` | Code scanning | [Observed] |
| Secret scanning | **gitleaks-action (SHA-pinned)** | security.yml | Secret detection (full history) | [Observed] |
| Dependency security | **npm audit (high+) + dependency-review** | security.yml, `scripts/dependency-review.sh` | Vulnerable-dep blocking | [Observed] |
| SBOM / provenance | **npm sbom (SPDX + CycloneDX)** | `release.yml` | Release evidence | [Observed] |
| Commit hygiene | **commitlint (conventional)** | `commitlint.config.cjs`, husky | Conventional commits | [Observed] |
| Telemetry | **OpenTelemetry SDK (node/metrics/trace OTLP)** | `src/framework/observability/*` | Metrics + traces | [Observed] |
| Logging | **pino 10 + pino-pretty** | `src/utils/logger.ts` | Structured logs + redaction | [Observed] |
| Pre-commit automation | **husky 9 + lint-staged 17** | `.husky/*` | Shift-left local gates | [Observed] |

### 4.1 How the toolchain is actually wired (not just which tools exist) [Observed]

- **One runner, four roles.** Vitest is the single runner for unit + integration + contract suites (`vitest.config.mts` `include` globs cover `unit/`, `integration/`, `contracts/`, and a `framework/` path). It runs in the `node` environment (no jsdom), which is why "unit" tests of `PageObjectBase` must inject a hand-built `PageMock` rather than render DOM. Playwright (`@playwright/test`) is a _separate_ runner with its own config (`configs/playwright.config.ts`) and its own `testDir` (`tests/suites/e2e`); the two never share a process.
- **Transform path = the latency tax.** Vitest transforms TypeScript on the fly (esbuild under the hood, but the measured cost is dominated by _import_ graph evaluation: 209s cumulative import vs 34s in-test for the 237-test run). Scripts that run outside Vitest (`scripts/*.ts`) are executed via `ts-node/register` (e.g., `flakiness:report`, `slo:dashboard`, `observability:ci:smoke`), so there are **two** TS execution paths in the repo (Vitest transform + ts-node), each with its own startup cost.
- **Coverage is v8, scoped, per-file.** `@vitest/coverage-v8` with `text` + `json-summary` reporters; thresholds are attached to 5 named files only (see §3.5). There is no `lcov`/Codecov upload and no global gate — coverage is a pass/fail guard on critical modules, not a measured trend.
- **Playwright config specifics**: `retries: CI ? 1 : 0`; `screenshot: 'only-on-failure'`; `video`/`trace: 'on-first-retry'`; `fullyParallel: true`; 6 projects (Chrome/Firefox/Safari/Edge channels + Galaxy S9+ / iPhone 13 device emulation); HTML reporter always, JSON reporter only when `PLAYWRIGHT_JSON_OUTPUT_FILE` is set (CI sets it per shard to feed flakiness aggregation).
- **OTel stack, exact**: `@opentelemetry/sdk-node` + `sdk-metrics` (2.7.x) + `exporter-trace-otlp-proto` / `exporter-metrics-otlp-proto` (0.218.x) + `semantic-conventions`. Telemetry is **disabled by default** (`resolveTelemetryConfig` returns no-op unless `AURORAFLOW_OBSERVABILITY_ENABLED=true`), so the SDK path only activates under explicit opt-in or the CI observability lanes.

### 4.2 Stack gaps (what is _not_ in the toolbox) [Observed]

- **No mutation testing** (Stryker) — so the dense unit assertions are never themselves validated for catch-rate.
- **No property/fuzz testing** (fast-check) — the scoring math, config parser, and retry/jitter are checked at hand-picked points, not across input space (relevant given §6's reachability findings).
- **No performance/load tooling** (k6/Artillery/autocannon/benchmark) — the only perf signal is the OTel `*_duration_ms` histograms the framework emits about itself; its own self-heal/DOM-snapshot overhead is unmeasured.
- **No consumer-driven contract tool** (Pact) — the "contract tests" are bespoke Vitest specs over the repo's own CI/docs/package text (appropriate, since there is no networked provider/consumer; see §5.2).
- **No visual-regression / snapshot testing** beyond JSON-shape assertions.
- **No flaky-test _quarantine_ mechanism** — flakiness is _reported_ (`flakinessReport.ts`) but the suite has no auto-retry-quarantine-and-track loop; Playwright `retries: 1` in CI is the only flake buffer.

---

## 5. Quality Architecture

### 5.1 The strategy is a _four-band_ model, not a classic pyramid [Observed/Inferred]

The repository does not use the textbook unit→integration→e2e pyramid. It runs **four distinct verification bands**, two of which are non-standard, and the band sizes (by assertion count, not file count — see §6.0) reveal where confidence actually comes from:

```
 Band                What it verifies                 Fidelity   Assertions   Speed     Determinism
 ───────────────────────────────────────────────────────────────────────────────────────────────
 Unit (pure logic)   src behavior in isolation         medium      ~750        fast      high (injected)
 Contract (bespoke)  CI/docs/infra/package text        n/a (meta)  ~320        fast      total (static)
 Integration         real Redis + real OTLP            high        ~48         slow*     high
 E2E (Playwright)    framework on synthetic DOM        highest     ~17         slowest   high
 ───────────────────────────────────────────────────────────────────────────────────────────────
 * Docker-gated; self-skips when Testcontainers/Docker is unavailable.
```

The striking shape: **as fidelity rises, assertion budget collapses** (480 → 320 → 48 → 17). The framework's confidence is overwhelmingly purchased at the _lowest-fidelity_ (pure-logic) and _meta_ (contract) bands; the high-fidelity bands are assertion-starved. For most products this is acceptable; for a framework whose value proposition is _resilient recovery against real DOM_, it is an inversion worth flagging (§6.0, §20-R1/R3).

### 5.2 The contract band is the genuine architectural innovation [Observed]

The 17-spec contract band is a deliberate "executable specification of the platform itself." It is not consumer-driven contract testing — it is **invariant-locking over the repo's own configuration**: that CI actions stay SHA-pinned, that the Security Gate wires every scanner, that the public API surface matches its documented stability tiers (via the TypeScript AST, §6.5), that Node 20/22/24 stays in the matrix, that publishing stays disabled. Architecturally this shifts a class of regressions (silently weakening a gate, breaking an API promise, doc drift) from _human review_ to _automated build failure_. The cost is that these assertions verify **shape, not effect** — they prove the gitleaks job is wired, not that a planted secret is blocked (§6.4).

### 5.3 Determinism architecture — the injection seams that make it possible [Observed]

The suite is fast and non-flaky because reliability-bearing code is built with explicit injection seams, enumerated here because they _are_ the testability architecture:

- `RedisClient`: injects `createClient`, `sleep`, `random`, `logger`, `env` → backoff sequences are asserted as exact arrays (`[10, 20]`) with `random: () => 0`.
- `retry()`: injects `random` and accepts `logger: null` → jitter is asserted exactly (`[12, 15]`).
- Telemetry: swapped globally via `setTelemetryForTests(new CapturingTelemetry())` → emitted spans/counters/histograms asserted by value.
- Repositories: inject `store` + `now()` → time and persistence are controllable; the memory store uses `advanceTime`, Redis uses real `setTimeout`.
- Governance/CLI scripts: tested by writing real artifact files to temp dirs and dynamically `import()`-ing the actual `.mjs`, asserting real exit codes.

The one seam that is _missing_ is in `PageObjectBase`, which reads `process.env` directly at failure time, forcing env-mutation in its self-heal specs (§8, §6.3).

### 5.4 Layered verification of the highest-risk feature (self-healing) [Observed]

Self-healing is not tested as one thing; it is decomposed into independently-verified layers — a model of how to test a dangerous feature, with one missing capstone:

```
 Layer                         Spec                              Status
 ──────────────────────────────────────────────────────────────────────────────
 1 candidate scoring/reachability  candidateScoring.spec          ✓ exact, symbolic vs DEFAULT gate
 2 guarded dry-run gate            guardedValidation.spec         ✓ policy + confidence + domain
 3 apply mechanics                 pageObjectBaseSelfHealing.spec ✓ but at LOWERED gate (0.3)
 4 failure artifact + schema       failureCapture / artifactSchema✓ schema-validated
 5 registry persistence + rollback registryPersistence/promotion ✓ CAS + rollback
 6 CI governance (human gate)      selfHealingGovernance.spec     ✓ blocks on unacked acceptance
 7 END-TO-END heal at real gate    — (none) —                     ✗ THE MISSING CAPSTONE
```

Layers 1–6 are individually strong; the architecture's gap is that **no single test composes them at the shipped `0.92` gate against a real browser** (§6.0, §20-R1).

### 5.5 CI execution topology (the job DAG) [Observed]

```
 PR / push:
   quality.yml  → preflight ─┬→ verify (Node 20·22·24, max-parallel 2)
                             ├→ coverage (Node 22, 5-module gate)
                             ├→ smoke-e2e (Chrome) → self-heal governance → [auto-issue on main]
                             └→ observability-stack smoke (path-filtered)
   security.yml → {dependency-review|npm-audit} · codeql · gitleaks · zizmor → security-gate (aggregator)
   examples.yml → preflight → examples (path-filtered)
 nightly (cron):
   ci.yml       → e2e (6 browsers × 2 shards, max-parallel 6) → flakiness-report → slo-dashboard
   quality.yml  → observability full-stack + remote-export smoke
   playwright-peer-matrix.yml → floor 1.59.1 / current / latest
 manual:
   release.yml  → peer-matrix → verify → build → pack-dry-run → SBOM → provenance → [publish-gate: REFUSES]
```

Two architectural patterns recur: **path-filter preflights** (skip heavy lanes when irrelevant files are untouched, but always run on `main`) and **aggregator gates** (`security-gate`, governance) that convert matrix fan-out into one blocking signal.

### 5.6 Ownership & shift-left [Observed]

- **Ownership.** Single maintainer (`@jsugg`); CODEOWNERS maps safety-first runtime areas and governance paths but is **advisory only** unless branch protection requires code-owner review (state unknown). This is the structural fragility under an otherwise mature setup (§20-R8 — a secondary, org-level concern, deliberately _not_ a top-line quality risk).
- **Shift-left.** Husky `pre-commit` (lint-staged: prettier + eslint --fix + shellcheck), `commit-msg` (commitlint), `pre-push` (`typecheck + test:unit + shellcheck`). Note `pre-push` runs unit but **not** integration/e2e/lint — those are CI-only, so the ~149s unit cost is the _local_ gate's tax and a real pressure point (§6.0, §20-R5).

---

## 6. Test Suite Deep Dive

### 6.0 Quantitative profile — interrogating the "1:1 test ratio" [Observed]

The headline that "AuroraFlow has a ~1:1 source-to-test LOC ratio" (11,717 src / 11,329 test) is a **vanity metric that should not be read as a strength**. A Principal-level decomposition tells a different and more useful story.

**Finding 1 — it is already lean, and net _negative_.** For a framework whose entire reason to exist is reliability, 0.97:1 (test < source) is on the low side; mature test libraries frequently run 1.5–3:1. The raw number is _below_ even the naive bar.

**Finding 2 — ~15% of "test" LOC tests no source behavior.** Of 11,329 test LOC: 1,400 LOC are **contract specs** asserting over YAML/Markdown/JSON _text_ (261 of their 320 assertions are `toContain`/`toMatch` on config strings — they protect against CI/doc drift but exercise zero `src/` code paths), and 334 LOC are reusable test _infrastructure_ (conformance suite, AST surface extractor). Subtracting these, **effective behavioral test LOC against `src/` ≈ 9,595 → a real ratio of ≈ 0.82 : 1.**

**Finding 3 — the ratio is inverted against risk.** Decomposed by subsystem (test LOC ÷ source LOC):

| Subsystem | Source LOC (% of src) | Behavioral test LOC | Ratio | Coverage-gated? |
| --- | --- | --- | --- | --- |
| `pageObjectBase` (core orchestrator) | 687 (6%) | 1,002 | **1.46 : 1** | partial |
| `data` (Redis/registry/stores) | 880 (8%) | 886 unit **+667 integration** | 1.01 / **1.77 : 1** | `historyRepository` only; CAS proof Docker-gated |
| `selfHealing` (**flagship, highest risk**) | 5,001 (**43%**) | 3,914 | **0.78 : 1** | 3 of 19 modules |
| `observability` | 3,456 (**29%**) | 2,083 | **0.60 : 1** | 1 of 15 modules |

The two largest, most novel surfaces — self-healing (43% of the codebase) and observability (29%) — carry the **lowest** test ratios (0.78 and 0.60), _and_ sit almost entirely **outside** the 5-module coverage gate. The well-tested modules (`pageObjectBase` 1.46:1, `data` 1.77:1 with integration) are the smaller, more conventional ones. So the LOC ratio is highest exactly where risk is lowest.

**Finding 4 — assertion density is modest and bimodal (3.64 expects/test overall).** Pure-logic unit specs run lean — selfHealing 2.9, observability 3.0, data 2.8 expects/test — i.e., many tests assert a single path with a couple of checks. Only `pageObjectBase` (6.0) and integration (5.3) are assertion-dense (they verify orchestration + telemetry + side-effects per test). **The fidelity inversion is starkest at e2e: 17 total assertions across 6 files / 8 test blocks / 298 LOC (2.1/test)** — the highest-fidelity band has the thinnest assertion budget in the entire suite, and the one self-healing e2e spends its ~3 assertions on artifact _shape_, not on proving a heal.

**Finding 5 — what LOC ratio structurally cannot see (why a Principal distrusts it).** It is blind to assertion _strength_, _branch_ coverage (the ~38 un-floored modules), _input-space_ coverage (no property/fuzz tests — the scoring/config/jitter math is checked at hand-picked points, §4.2), _adversarial_ cases, and _fidelity_ (synthetic e2e). Crucially, the code I read shows assertion **craftsmanship is high** where tests exist (exact backoff arrays, concurrent-CAS winner counts, 120-observation exact counters — §6.1). **So the problem is not test quality; it is test _distribution and fidelity_:** a lean, risk-inverted allocation with an assertion-starved high-fidelity frontier, dressed up by a flattering aggregate ratio.

> **Net:** treat the 1:1 ratio as **neutral-to-concerning**, not a strength. The actionable reframings are R2 (floor the un-tested 72% of source), R1/R3 (fund the assertion-starved e2e frontier for the flagship feature), and a push for assertion-strength signals (mutation testing) over LOC vanity (R-near-term-7).

### 6.1 Unit band — assertion-quality grading [Observed]

Graded by _what the assertions actually prove_, not by count:

- **Reliability primitives — grade A (behavioral, exact, deterministic).** `retry.spec.ts` asserts the exact backoff sequence `[10, 20]` and the exact jittered+capped sequence `[12, 15]` (deterministic `random: () => 1`), proves invalid options reject **before** any delay is scheduled (`fn` never called), and that an out-of-range `random` aborts mid-flight (`attempts === 1`). `redisClient.spec.ts` asserts exact `sleep` durations, retry _counts_ (`get` 3×, `set` 3× = maxRetries+1), and the full telemetry side-effect set (span status, `attempts`/`retries` attributes, counter + histogram emission) for both success and exhaustion. These are model unit tests.
- **`PageObjectBase` error/lifecycle — grade A.** `pageObjectBase.spec.ts` asserts exact wrapped messages (`'Error typing in selector #username: fill failed'`), screenshot-path _sanitization_ (`not.toContain(':')`), **init concurrency** (action blocks until an in-flight `initialize` deferred resolves; `fill` not called early), init-failure short-circuit, `open()` ordering (`['goto','initialize']`), and that **input validation precedes Playwright invocation** (asserts `click/fill/waitForSelector/screenshot` _not_ called for bad timeouts) — proving the guard is a true precondition, not post-hoc.
- **Self-healing scoring/reachability — grade A− (precise but point-sampled).** `candidateScoring.spec.ts` proves, _symbolically against `DEFAULT_SELF_HEAL_MIN_CONFIDENCE`_ (so it survives a default change): fresh heuristic + fresh DOM candidates stay **below** the gate; only curated registry confidence (0.94) or accumulated positive history clears it; test-id evidence outranks CSS fallback. Deduction: it samples a handful of hand-built candidates, not the input space — a strategy fast-check would harden.
- **Observability math/config — grade B+.** `sloDashboard`, `flakinessReport`, `trends`, `alertPolicies`, `telemetry` specs assert computed values, `insufficient_data` handling, atomic JSONL append (sorted, bounded, malformed-line skipping), and that breach counters carry **no raw alert text** (privacy). Lean density (3.0/test) but the assertions are value-level, not shape-level.
- **Config/logger/privacy — grade A on security-relevant paths.** `config.spec.ts` proves diagnostics **never echo received env values** (secret-safety) and strict-mode throw/warn semantics. `logger.spec.ts` proves redaction at the byte level: `expect(chunks[0]).not.toContain(SYNTHETIC_SECRET)` — the secret never reaches serialized output.

### 6.2 Integration band — the crown jewels (grade A), but conditionally executed [Observed]

`redisIntegration.spec.ts` is the highest-value file in the suite. Against a real `redis:7.2-alpine` container it proves the guarantees that _cannot_ be faked:

- **Optimistic concurrency:** two concurrent `expectedVersion:1` upserts via `Promise.allSettled` → asserts **exactly one** fulfilled, one rejected with `SelectorRegistryConflictError`, final `version === 2`.
- **Atomic exactly-once counting:** **120 concurrent** `recordObservation` calls with deterministic status patterns → asserts the _exact_ merged counters `attempts: 120, validated: 60, guardedApplySucceeded: 40, guardedApplyFailed: 24` plus TTL-derived `expiresAt`. This is the single strongest reliability proof in the repo and directly verifies the Lua `EVAL` atomic-merge.
- **TTL keyspace isolation, promotion approve/reject/conflict/rollback** against real Redis.

**The architectural caveat:** all of this lives behind `beforeAll` that self-skips (recording a reason) when Docker/Testcontainers is unavailable. So the repo's strongest guarantees are **conditionally executed** — in a Docker-less environment the atomicity proof silently degrades to "skipped." The phase-0 validation baseline mandates recording the skip and keeping the PR blocked unless a maintainer accepts, which mitigates but does not eliminate the risk. `otelTelemetryExport.spec.ts` is the only other real-dependency test (real OTLP export of representative spans/metrics).

### 6.3 `PageObjectBase` self-healing unit specs — grade A− with one systemic caveat [Observed]

`pageObjectBaseSelfHealing.spec.ts` (9 tests, 6.0 assertions each — the densest in the suite) genuinely proves the apply mechanics: guarded click/clickWhenVisible auto-apply succeeds and is recorded in the artifact _and_ telemetry; SAT-ranked registry candidates drive the retry; apply _failures_ are recorded **without swallowing the original error**; policy-blocked candidates skip application. **The systemic caveat (the §6.0/§20-R1 thread):** every one of these sets `SELF_HEAL_MIN_CONFIDENCE='0.3'`. Combined with §6.1's reachability tests proving fresh candidates can't clear `0.92`, the suite proves _mechanics at 0.3_ and _reachability at 0.92_ separately, but **never both together** — and these specs also mutate `process.env` (restored in `finally`), the one place the determinism architecture leaks global state (§5.3).

### 6.4 Contract band — grade B (high leverage, shape-only) [Observed]

72 tests / 320 assertions, of which 261 are `toContain`/`toMatch` over config text. They lock real invariants (SHA-pinned actions, Security-Gate wiring, Node 20/22/24 matrix, sharding, dependabot scope, release-publish-disabled, observability label truth) and are very high ROI for drift protection. The ceiling: they verify **declared shape, not runtime effect** — `security-secret-scan.contract.spec.ts` proves the gitleaks job exists and is wired, not that a planted secret is blocked; `dockerCompose.contract.spec.ts` proves the healthcheck is declared, not that it passes. A few (e.g., `observabilityContract`'s "snapshot-proven Prometheus labels", `slo-dashboard-alerting`'s scoring/threshold drift test) reach into real artifact JSON and are stronger than pure-string matching.

### 6.5 Package-surface band — grade A (AST-level, not string) [Observed]

`packageSurface.spec.ts` + `apiStabilitySurface.ts` parse `src/index.ts` with the **TypeScript compiler API**, extract every named export in declaration order, **reject `export *`** to keep the inventory exhaustive, and cross-check against the `docs/api-stability.md` tier table (every export classified; unknown tier/kind throws; duplicates flagged). This makes the public API surface a _compile-checked contract_ — a backward-compatibility guarantee well above the usual snapshot test.

### 6.6 E2E band — grade C (thin, synthetic, flagship-blind) [Observed]

6 specs, 17 assertions, all against `page.setContent(...)` DOM. They cover axe accessibility (2), deterministic network mocking, the demo page object, quickstart form submit, and retry/timeout recovery — adequate smoke for _plumbing_. The decisive weakness (§20-R1/R3): `self-healing-sat.spec.ts` runs in `SELF_HEAL_MODE='suggest'` and asserts only that the SAT artifact is _enriched_ with candidates; **no e2e drives a guarded auto-apply to success**, and none runs against non-trivial DOM (shadow DOM, iframes, dynamic re-render) where self-healing is supposed to earn its keep. The highest-fidelity band is also the one that never exercises the feature the product is named for.

### 6.7 Cross-cutting reliability & maintainability of the suite [Observed]

- **Flakiness risk: low.** Determinism is engineered in (injected RNG/clock, `clearMocks`, no real network at unit level). The residual hazards are the `process.env` mutation in self-heal specs (relies on Vitest per-file isolation) and the real-`setTimeout(1200)` TTL waits in integration (slow, but bounded).
- **Maintainability: high craftsmanship, two debts.** Shared abstractions (CapturingTelemetry, conformance suite, AST surface) keep duplication low. Debts: (1) ~149s unit wall-clock (import-bound) taxes the `pre-push` loop; (2) the env-mutation coupling in self-heal specs.

---

## 7. Verification Lifecycle

How confidence accumulates from keystroke to release: [Observed]

1. **Developer / local.** `npm run verify` = `verify:tools` (actionlint) → `format:check` → `lint` → `typecheck` → `test:unit` → `test:contracts` → `test:integration` → `schemas:check` → `shellcheck` → `workflows:lint`. This is the single canonical gate a contributor runs. `npm test` aliases the unit-only fast path.
2. **Pre-commit (husky).** lint-staged formats + lint-fixes staged files; shellcheck on `*.sh`. **Commit-msg:** commitlint enforces Conventional Commits.
3. **Pre-push (husky).** `typecheck` + `test:unit` + `shellcheck` — blocks pushing code that fails fast checks (but **not** integration, e2e, or lint — those rely on CI).
4. **Pull request (CI).** _Quality Gates_ (`verify` across Node 20/22/24, critical-module coverage, observability collector smoke on relevant changes, smoke-e2e + self-heal governance). _Security_ (dependency-review on PRs; CodeQL/npm-audit/gitleaks/zizmor; Security Gate aggregator). _Examples_ (path-filtered). Concurrency groups cancel superseded runs.
5. **Push to `main`.** Same gates run unconditionally (path filters are bypassed: `github.ref == 'refs/heads/main'`), plus the heavier observability smoke.
6. **Nightly / scheduled.** Full E2E matrix (`ci.yml`, 6 browsers × 2 shards) at 03:00; observability full-stack + remote-export smoke; weekly security deep-scan and Playwright peer matrix.
7. **Pre-release.** `release.yml` (manual dispatch) runs peer matrix → `verify` → build → `npm pack --dry-run` → SBOM (SPDX + CycloneDX) → provenance-readiness check → changelog draft → uploads `release-dry-run-evidence`. **Publishing is gated off** by policy (`AUR-DEC-012`); a non-empty confirmation routes to a job that _refuses_ to publish.
8. **Production validation.** Not applicable in the traditional sense (library, not service). The closest analog is the **observability live-export / backend-snapshot assertions** that validate telemetry label truth against a real collector. [Observed/Inferred]

**Assessment.** This is a well-sequenced, mostly-blocking pipeline with sensible cost control (path filters, sharding). The one notable asymmetry: **e2e/integration do not run on pre-push and are path-filtered on PRs**, so a change that only touches non-`src` paths can merge without ever running the browser suite — acceptable given cost, but worth knowing.

---

## 8. Testability Assessment

| Dimension | Finding | Evidence | Tag |
| --- | --- | --- | --- |
| **Dependency injection** | Strong. `RedisClient` injects `createClient`, `sleep`, `random`, `logger`, `env`; repositories inject `store` + `now`; telemetry is swappable via `setTelemetryForTests`. | `src/utils/redisClient.ts` ctor; `historyRepository`, `promotionWorkflow` ctors | [Observed] |
| **Mockability** | High without a mocking library — DI + small interfaces (`SelectorStore`, `SelfHealingRegistryRuntime`, `FailureArtifactWriter`). | `src/data/selectors/selectorRegistry.ts`, `registryContracts.ts` | [Observed] |
| **Isolation boundaries** | Clean module boundaries; pure scoring/config/trend functions with no I/O. | `scoringPolicy.ts`, `candidateScoring.ts`, `config.ts` | [Observed] |
| **Determinism** | Mostly deterministic: injected RNG/clock, `clearMocks: true`, fixed-seed fixtures. Jitter math is tested with a deterministic `random`. | `helpers.ts` `applyJitter`, redis backoff tests | [Observed] |
| **Configurability** | Extensive env-driven config with validation + diagnostics that never echo secret values. | `config.ts`, `logger.ts`, `telemetryConfig.ts` | [Observed] |
| **Data-setup complexity** | Low for unit (literals); moderate for integration (Testcontainers Redis). | `redisIntegration.spec.ts` | [Observed] |
| **Environment requirements** | Unit needs only Node; integration needs Docker; e2e needs Playwright browsers. Graceful skip when Docker absent. | `redisIntegration.spec.ts` skip path | [Observed] |
| **State management** | A latent barrier: `PageObjectBase` reads `process.env` directly inside the failure path (`resolveSelfHealingConfig(process.env)`, `resolveRegistryRuntime(process.env)`), so its self-heal tests must mutate/restore global env. | `pageObjectBase.ts:258,202` | [Observed] |

**Architectural barriers to testing.** [Inferred] (1) `process.env` is read at call-time inside `PageObjectBase` rather than injected, forcing env-mutation tests and constraining safe parallelism. _This is the only barrier whose clean fix needs production code — and that fix is already scheduled as Phase 2 `AUR-IMPL-021` (`AuroraFlowContext`); the test-only interim is `vi.stubEnv` (§23.1), not a `src/` change._ (2) The richest behavior (guarded auto-apply against a real browser) requires a real Playwright `Page` and a _populated registry_, which raises the setup bar enough that no such test currently exists — but it is reachable test-only via a fixture app + the public registry API (§23.1), no code change required. (3) Module-level singletons (`mainLogger`, `getTelemetry()` default) are pragmatic but require explicit reset hooks (`resetRedisClientForTests`, `setTelemetryForTests`) that callers must remember.

---

## 9. Reliability Engineering Assessment

**Error handling.** [Observed] Consistent, typed error taxonomy: `PageActionError`/`PageActionInputError`, `RedisConfigError`/`RedisConnectionError`/`RedisOperationError`, `SelfHealingConfigError`, `LoggerConfigError`, `SelectorRegistry*Error`. The page-action path wraps failures, records the exception on the span, captures a screenshot (privacy-gated) and a structured failure artifact, and re-throws a `PageActionError` that preserves the original `cause` — so diagnostics are rich and the original error is never swallowed (verified by the unit test "records guarded auto-heal apply failures without swallowing the original action error"). Only 36 `catch` sites across ~11.7k LOC, and they are deliberate (analysis/screenshot/capture failures are logged-and-continued so a self-heal hiccup can't mask the real failure).

**Retry behavior.** [Observed] Two independent, well-bounded implementations:

- `helpers.ts retry()` — validates all options (RangeError on out-of-range), exponential backoff with capped delay + optional bounded jitter, injectable `random`, configurable logger. Max 20 retries / 60s wait hard caps.
- `RedisClient.executeWithRetry` — attempt loop with `computeBackoffDelay` (exponential + jitter, capped at `maxBackoffMs`), wraps exhausted retries in `RedisOperationError(operationName, attempt, cause)`, and emits retry counters/histograms to OTel.

**Timeout handling.** [Observed] Action timeouts are validated as bounded integers (`validateBoundedInteger`, `MAX_EXPLICIT_WAIT_TIMEOUT_MS`); Redis has `connectTimeoutMs`; Playwright config sets retries (`CI ? 1 : 0`) and trace/video on first retry.

**Concurrency / idempotency.** [Observed] `connect()` de-dupes concurrent connects via a shared `connectPromise`; `ensureInitialized()` de-dupes page-object init via a shared `initializationPromise`. Cross-process write safety for selector data uses **server-side atomicity**: a Lua `EVAL` compare-and-set (`compareAndSetJsonVersion`) and an atomic JSON merge (`atomicJsonMerge`) — the validation baseline explicitly forbids substituting process-local locks for this. The `reconnectStrategy` caps reconnect attempts and backs off.

**Failure recovery / resilience.** [Observed] `reconnectStrategy` returns `false` past `maxRetries` to stop runaway reconnects; `disconnect()` falls back from `quit()` to `disconnect()`; telemetry degrades to a no-op implementation when disabled (`noopTelemetry.ts`).

**Are reliability claims verified by tests?** [Observed] **Largely yes at the unit level:** backoff/jitter math, retry exhaustion, CAS semantics, and atomicity (via real Redis in integration, satisfying `AUR-IMPL-005`) are tested. **The gap is the self-healing auto-apply reliability claim:** the "retry once and preserve the original failure" contract is unit-tested with a _mocked_ page at a _lowered_ gate, but there is no test proving the full guarded recovery succeeds against a real browser at the shipped default (`0.92`).

---

## 10. API and Contract Validation

- **Public API surface.** [Observed] `src/index.ts` is a single, curated barrel (~360 lines) re-exporting the entire public surface with explicit type exports. A **stability-tiered** policy exists (`docs/api-stability.md`, ADR-0002) and is _enforced by tests_: `tests/helpers/apiStabilitySurface.ts` + `publicApi.spec.ts` + `packageSurface.spec.ts` assert the exported names/shape, and a contract spec asserts the _packaged_ surface (`tests/suites/contracts/package/packageSurface.contract.spec.ts`). This is real backward-compatibility protection for a library. [Observed]
- **Schema validation.** [Observed] 10 JSON Schemas (`schemas/`) define the self-healing failure event, DOM snapshot, candidate history, pending promotion, flakiness summary, SLO dashboard/alert, observability trend point, governance summary. `ajv` validates artifacts at runtime (`artifactSchema.ts`) and `scripts/schemas-check.ts` (`schemas:check`) checks schema integrity; `artifactJsonSchemas.spec.ts` asserts emitted artifacts conform.
- **Contract testing.** [Observed] As above (§6), the bespoke contract suite pins CI/docs/infra/package invariants. There is **no consumer-driven contract** (Pact) because there is no networked provider/consumer — appropriate for a library.
- **Error-contract validation.** [Observed] Error _types_ and messages are asserted in unit tests (e.g., `rejects.toThrow('Error clicking on selector ...')`), and config diagnostics carry stable `code` enums. There is no formal error-response schema (not applicable to a library).
- **Gap.** [Inferred] HTTP/API request testing in the traditional sense does not apply; the relevant "API" is the TypeScript surface, which is well guarded. Backward-compatibility across _Playwright peer versions_ is validated by the peer matrix (floor 1.59.1 / current / latest), a strong and unusual move.

---

## 11. Data Quality and Persistence Testing

- **Persistence model.** [Observed] Redis-backed selector registry, candidate history, and pending promotions, all JSON-encoded with explicit **version fields** for optimistic concurrency. A pluggable `SelectorStore` abstraction has two implementations (`redisSelectorStore`, `memorySelectorStore`) sharing one conformance suite.
- **Migration testing.** [Observed] **None / not applicable** — there is no schema-migration framework; selector records are versioned per-record (not a global migration). Candidate IDs carry a `v2::` prefix scheme (`buildSelfHealingCandidateId`) indicating an intentional, forward-compatible ID-format evolution, but no migration test exists. [Observed]
- **Data validation.** [Observed] All persisted artifacts are ajv-schema-validated on parse (`parseSelectorCandidateHistory`, `parsePendingSelectorPromotion`, etc.); invalid data raises `SelfHealingArtifactSchemaError`.
- **Schema consistency.** [Observed] Enforced both by `schemas:check` and by `artifactJsonSchemas.spec.ts`.
- **Transaction / integrity.** [Observed] Atomicity is server-side via Lua `EVAL` (CAS + JSON merge) and verified against real Redis in the integration suite — the strongest data-integrity evidence in the repo (`AUR-IMPL-005`: "Concurrent observations preserve exact counts").
- **Data lifecycle.** [Observed] TTLs are first-class and bounded (`DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS`, `MAX_*`, normalized via `normalizeTtlSeconds`); TTL expiry is tested in integration; retention/privacy policy is documented (`docs/operations/privacy-retention.md`). [Observed]
- **Gap.** [Inferred] No test exercises _corrupt/legacy_ persisted records being read by a newer code version (forward/backward artifact compatibility), and there is no migration path test for the `v2::` ID transition.

---

## 12. Security Verification Strategy

| Control | Status | Evidence | Severity if absent / Confidence |
| --- | --- | --- | --- |
| **SAST** | Present | CodeQL `javascript-typescript`, blocking on push/schedule via Security Gate | High value / [Observed] |
| **Secret detection** | Present | gitleaks-action (SHA-pinned), full-history fetch, wired into Security Gate | High / [Observed] |
| **Dependency scanning** | Present | `dependency-review.sh` (PR), `npm audit --audit-level=high` (push/schedule) | High / [Observed] |
| **Workflow/supply-chain hardening** | Strong | All actions SHA-pinned; `persist-credentials: false`; least-privilege `permissions:` per job; zizmor analysis | High / [Observed] |
| **Secret redaction in logs** | Present | pino redacts password/token/apiKey/authorization/etc. by default; config never echoes raw env values | High / [Observed] |
| **Input validation** | Present | Bounded-integer validation on timeouts/retries; env parsing with diagnostics; URL/host parsing guarded | Medium / [Observed] |
| **Privacy controls for artifacts** | Present | `artifactPrivacy.ts` redacts DOM attribute values, gates screenshots; sensitive preset; tested with synthetic secrets | Medium / [Observed] |
| **AuthN/AuthZ testing** | N/A (library) | No auth surface; Redis username/password supported but no auth test | Low / [Observed] |
| **SBOM / provenance** | Present (dry-run) | SPDX + CycloneDX generated; provenance-readiness checked; real provenance deferred per `AUR-DEC-012` | Medium / [Observed] |

**Severity-classified findings.** [Inferred] _No High-severity security gaps observed in the framework's own posture._ The most notable **Medium** items: (1) gitleaks/secret-scan is structurally verified by a contract test but there is no test that a planted synthetic secret is actually _blocked_ end-to-end; (2) the Redis client supports TLS and credentials but there is no test exercising an authenticated/TLS connection (integration uses an unauthenticated container). **Low/Informational:** CODEOWNERS is advisory, so security-sensitive paths are not _required_ to receive owner review unless branch protection is configured (state of branch protection is **[Unknown]** from the repo).

---

## 13. Performance and Scalability Validation

- **Load / stress / benchmarking: none.** [Observed] No load-testing tool, no benchmark suite, no capacity test. This is **appropriate** for a test-automation library — it has no served throughput to load-test — but it means the framework's _own_ overhead (e.g., self-healing analysis cost on every failure, DOM snapshot extraction up to `maxDomNodes`) is **not measured**. [Inferred]
- **Resource-utilization signals.** [Observed] The framework _emits_ duration histograms (`auroraflow.action.duration_ms`, `auroraflow.redis.operation.duration_ms`) and bounds its own work (`SELF_HEAL_MAX_DOM_NODES` default 500 / hard cap 5000, `maxCandidates`, `maxTextLength`) — so runaway cost is structurally bounded, but the bounds' performance impact is unverified.
- **Scalability of the test system itself.** [Observed] E2E scales via a 6×2 browser/shard matrix; unit/integration are single-process. The flakiness/SLO trend files are capped (`--trend-limit 250`) and cached across runs, bounding growth.
- **Proven vs. assumed.** _Proven:_ the framework bounds its own resource consumption by configuration. _Assumed:_ that those defaults are performant at scale, and that self-healing analysis does not materially slow large suites — **[Unknown]**, no benchmark.

---

## 14. Observability and Diagnosability

**This is a standout area.** [Observed]

- **Logging quality.** Structured JSON via pino; secret redaction on by default; configurable level/destination/redaction via env with validation; **log↔trace correlation** through a pino `mixin()` that injects `getTelemetryLogCorrelation()` (trace/span IDs), so logs and traces are joinable.
- **Metrics coverage.** A named, enforced metric catalog (`METRIC_NAMES`, `REQUIRED_METRIC_NAMES`) covering page actions (total/failures/duration), Redis ops (total/retries/duration), guarded validation/auto-heal, self-healing suggestions, and registry writes — with attribute builders that hash sensitive values (`hashTelemetryValue`). Label _truth_ is asserted against a real collector (`observability:live-assert`, `observabilityLiveExportAssert.spec.ts`).
- **Tracing.** OTel spans for page actions, guarded validation, and Redis operations, with rich attributes (status, attempts, retries, accepted-locator strategy, self-heal mode).
- **Health checks / alerting.** A full local stack (OTel collector, Prometheus + rules, Grafana dashboards/datasources, Jaeger, ELK) with CI smoke that asserts targets are `up`, metrics are scraped, traces exported, logs indexed, and Kibana data views exist. An SLO dashboard + alert-policy evaluator (`slo:alerts`) can fail CI on breach when `SLO_ALERT_FAIL_ON_BREACH=true`.
- **Failure diagnosability.** On any page-action failure the framework writes a schema-validated artifact bundling the error, DOM snapshot, ranked candidates, guarded-validation decision, registry persistence summary, and correlation IDs.

**Can production failures be investigated efficiently?** [Inferred] **Yes, for consumers who run the observability stack** — the correlation IDs, structured artifacts, and trace/log join make a failed test highly diagnosable. The caveat: this richness is opt-in (`AURORAFLOW_OBSERVABILITY_ENABLED`) and the full backend stack is heavyweight; the _default_ experience is structured logs + on-disk artifacts, which is still strong.

---

## 15. CI/CD Quality Gates

- **Required checks (blocking).** [Observed] _Quality Gates:_ `verify` on Node 20/22/24, critical-module coverage, smoke-e2e + self-heal governance, observability collector smoke (conditional). _Security:_ dependency-review (PR) / npm-audit (push) / CodeQL / gitleaks / zizmor, aggregated by `security-gate`. Whether these are _marked required in branch protection_ is **[Unknown]** from the repo (the gates exist and are designed to block, but enforcement config is server-side).
- **Test execution stages.** [Observed] Fast `verify` → coverage → conditional heavy lanes → nightly full E2E matrix. `*-gate` jobs (`security-gate`, governance) translate matrix fan-out into one pass/fail.
- **Coverage enforcement.** [Observed] Per-file thresholds on 5 critical modules only; **no global floor** (see §16, §20-R2).
- **Build validation.** [Observed] `release.yml` builds, dry-run-packs, and validates the published tarball shape + provenance prerequisites.
- **Deployment / rollback gates.** [Observed] Publishing is **intentionally disabled**; the `publish-gate` job exists as a protected-environment placeholder that _refuses_ to publish and documents the required future controls (OIDC id-token, required reviewers, sign-off). There is therefore **no rollback validation** because there is no deploy — consistent with the stated policy.

**Release confidence.** [Inferred] For a dry-run library release, confidence is **well-established**: every release produces auditable evidence (pack report, SBOMs, provenance readiness, changelog draft) gated behind the full `verify` + peer matrix. The unenforced-branch-protection unknown is the main residual.

---

## 16. Quality Metrics and Signals

| Signal | Present? | Evidence | Tag |
| --- | --- | --- | --- |
| Coverage metrics | Partial (5 modules) | `vitest.config.mts`, `test:coverage`, text+json-summary reporters | [Observed] |
| Flakiness tracking | **Yes** | `flakinessReport.ts`, `flakiness-report.ts`, trend JSONL cached across CI runs (`--trend-limit 250`) | [Observed] |
| SLI / SLO | **Yes** | `sloDashboard.ts`, `slo-alert-policy.json`, `slo:alerts`, trend persistence | [Observed] |
| Test-execution metrics | Yes (emitted) | OTel histograms + Playwright JSON reporter per shard | [Observed] |
| Reliability metrics | Partial | Redis op success/retry counters; page-action failure counters | [Observed] |
| Defect/escape trend | **No** | No defect-tracking integration or escaped-bug metric in repo | [Observed] |
| Global coverage trend | **No** | Only per-file critical thresholds; no codecov/coverage history | [Observed] |
| Mutation score | **No** | No Stryker/mutation testing | [Observed] |

**Missing signals (notable).** [Inferred] (1) A _global_ coverage number/trend — today you cannot tell, from CI, whether overall coverage is rising or falling. (2) Mutation testing — given the heavy reliance on unit tests for reliability primitives, mutation score would materially raise confidence that those tests actually _catch_ regressions. (3) Real-world flakiness baseline — the machinery exists, but there is no committed historical baseline to compare against (it is built per-CI-run and cached).

---

## 17. Automation Maturity Assessment

- **Breadth.** [Observed] High — local hooks, six CI workflows, security scanning, observability smoke, release evidence, peer-compat matrix, dependabot for npm + actions.
- **Depth.** [Observed] High on framework-internal logic and CI/infra invariants; **shallow on realistic end-to-end recovery** (synthetic e2e pages only).
- **Maintainability.** [Observed] Strong: strict TS, zero `eslint-disable`/`@ts-ignore`/`as any` in `src`, exactly one tracked `TODO` (with a task ID, `AUR-IMPL-020`), shared conformance suites reduce duplication. Tests do carry some env-mutation coupling.
- **Execution speed.** [Observed] **A growing concern** — 237 unit tests took ~149s locally; the dominant cost is TS transform/import, not test logic (34s in-test vs. 209s cumulative import). This is the weakest sustainability axis.
- **Parallelization.** [Observed] E2E parallelizes (6×2 matrix, `fullyParallel: true`); peer matrix and Node matrix parallelize; unit/integration are effectively single-process per file.
- **Cost efficiency.** [Observed] Good — path-filter preflights skip heavy lanes; trend files capped; concurrency cancels superseded runs; heavy full-stack/remote observability only on schedule/dispatch.

**Sustainability as the system grows.** [Inferred] The _structure_ scales well (clear layering, DI, shared suites, gated CI). The two scaling risks are (a) **unit-suite wall-clock time** dragging the shift-left loop, and (b) **the un-floored coverage surface** allowing the ~38 unmeasured modules to accumulate untested branches as features land.

---

## 18. Quality Fitness for the Current Product

_(First-class section.)_ Does the quality strategy match the product?

| Factor | Product reality (evidence) | Quality investment | Fit |
| --- | --- | --- | --- |
| Product complexity | High for its size: self-healing scoring, Redis CAS, OTel, multi-browser | Deep unit + contract + integration | **Good** |
| Team size | Single maintainer (`@jsugg`, CODEOWNERS) | Heavy automation compensates for no reviewers | **Good but fragile** (bus factor) |
| Operational criticality | Tool that can _mask product regressions_ if auto-heal misfires | Off-by-default, policy/confidence/dry-run gated, ADR-governed | **Strong on policy, weak on E2E proof** |
| Deployment frequency | Frequent small PRs (#82-#84 recent); not yet published | Fast PR gates + dry-run release | **Good** |
| Reliability expectations | Implicit "don't lie about test results" | Reliability primitives well unit-tested | **Good** |
| Security requirements | Supply-chain sensitive (npm lib) | CodeQL/gitleaks/zizmor/audit/SBOM | **Strong** |
| Compliance | None stated | n/a | **[Unknown]** |
| Customer impact | **[Unknown]** adoption/scale | n/a | **[Unknown]** |

**Is testing under-, over-, or appropriately engineered?** [Inferred] **Well-crafted but mis-allocated: the test _effort_ is inverted against risk** (§6.0). It is not uniformly under- or over-engineered — it is _unevenly_ engineered.

- _Appropriately engineered (small, conventional surfaces):_ reliability primitives, data atomicity (1.77:1 with integration), config validation, security, and the `pageObjectBase` orchestrator (1.46:1) are proportional to the "don't give false signals" risk and are assertion-dense.
- _Under-engineered relative to size and risk (large, novel surfaces):_ self-healing (43% of source, 0.78:1, 3 of 19 modules coverage-gated) and observability (29% of source, **0.60:1**, 1 of 15 gated) — the biggest and most differentiating code — carry the _lowest_ test ratios and sit mostly outside the coverage floor. The headline auto-apply path additionally lacks an end-to-end test at the shipped gate. This is the core finding: investment tracks _familiarity_, not _risk_.
- _Arguably over-engineered for current adoption:_ a full ELK + Prometheus + Grafana + Jaeger local stack with CI smoke and remote-export assertions is a lot of machinery for a pre-publication, single-maintainer library — excellent engineering whose _current_ ROI depends on real consumers (**[Unknown]**). Notably, this heavily-built observability _stack_ coexists with the _thinnest_ test ratio (0.60:1) on the observability _source code_ it instruments.

**Which investments are paying off?** [Inferred] The contract suite (cheap, high drift-protection), strict typing + DI (cheap, high regression-protection), and the Redis atomicity tests (directly de-risk data corruption).

**Which risks are inadequately covered?** [Observed/Inferred] (1) End-to-end self-heal activation at `0.92`. (2) The ~38 un-floored modules. (3) Realistic-DOM e2e. (4) Forward/backward artifact compatibility.

**Which activities look accidental vs. intentional?** [Inferred] Almost everything is _intentional_ and traceable to an ADR / decision-log ID / task ID — this is one of the most intention-documented repositories of its size. The only "accidental"-looking gaps are emergent (suite slowness, coverage scope) rather than careless.

**How long can the current strategy scale?** [Inferred] The _architecture_ of quality scales for years; the _operational_ limits are the single-maintainer bus factor and unit-suite latency, both of which bite within months if adoption grows.

---

## 19. Quality Strengths

1. **Self-referential contract test suite (17 specs).** _Why it matters:_ turns CI/security/docs/package drift into automated build failures — a class of regression most repos catch only in review. _Evidence:_ `tests/suites/contracts/**` (e.g., gitleaks SHA-pin assertion). _Risk reduction:_ prevents silent weakening of gates and accidental public-API breakage. _Preserve:_ keep contract specs updated _in the same PR_ as any workflow/doc/surface change; consider a meta-test that fails if a new workflow lacks a contract.
2. **Reliability primitives are densely, deterministically unit-tested.** _Why:_ retry/backoff/jitter, Redis CAS/atomic-merge, and config validation are the load-bearing correctness guarantees. _Evidence:_ `helpers.ts`, `redisClient.ts` + injected RNG/clock, integration atomicity test. _Preserve:_ keep injection seams; never replace Redis atomicity with process-local locks (already a documented rule).
3. **Supply-chain & CI security posture.** _Why:_ an npm library is a supply-chain target. _Evidence:_ SHA-pinned actions, `persist-credentials:false`, least-privilege per-job permissions, CodeQL/gitleaks/zizmor/audit/SBOM. _Preserve:_ keep dependabot grouping + the Security Gate aggregator.
4. **First-class observability with redaction and label-truth assertions.** _Why:_ makes consumer test failures diagnosable and prevents telemetry lying. _Evidence:_ pino redaction, OTel metric catalog, `observability:live-assert`. _Preserve:_ keep `REQUIRED_METRIC_NAMES` enforced.
5. **Governance & intentionality.** _Why:_ every major choice is traceable (ADRs 0001-0006, decision log, phase-0 validation baseline, task IDs). _Evidence:_ `docs/adr/`, `docs/architecture/decision-log.md`, `phase-0-validation-baseline.md`. _Preserve:_ keep ADR-on-change discipline.
6. **Safety-first self-healing defaults.** _Why:_ default `off`, dry-run-validated, confidence- and policy-gated — structurally prevents the worst failure mode (silent regression masking). _Evidence:_ `config.ts` defaults, ADR-0001. _Preserve:_ keep the gate conservative.

---

## 20. Quality Risks and Technical Debt (Prioritized Register)

> Severity = product/quality impact; Confidence = certainty of the finding from evidence.

> The register is ordered by genuine systemic severity, not by ease of fixing. R0 is the master finding; R1–R4 are its severe, correctness-level symptoms; R5–R8 are secondary (productivity/org/hygiene) and are explicitly held _below_ the core gaps so they cannot crowd the roadmap.

### R0 — Test investment is inverted against risk and fidelity _(master finding)_

- **Severity:** High (systemic) · **Confidence:** High (measured, §6.0)
- **Evidence:** Behavioral test ratio by subsystem: self-healing **0.78:1** (5,001 src, 43% of code, 3/19 modules coverage-gated), observability **0.60:1** (3,456 src, 29%, 1/15 gated) — the two largest, most novel, highest-severity surfaces are the _least_-tested; the high ratios belong to the small conventional code (`pageObjectBase` 1.46:1, `data` 1.77:1 with integration). Assertion budget _collapses as fidelity rises_ (unit ~750 → contract 320 → integration 48 → e2e 17). Net of contract-text/helpers the aggregate ratio is ≈0.82:1, not the cited 1:1.
- **Impact:** Confidence is concentrated where it is cheapest to obtain and scarce where failure is most expensive. Every other severe risk below is a facet of this allocation. The observability _stack_ over-investment (full ELK/Prom/Grafana/Jaeger) coexisting with a 0.60:1 ratio on the code that _emits_ the telemetry is the clearest symptom of effort tracking familiarity, not risk.
- **Likelihood:** Certain (it is the current state).
- **Escape scenario:** Feature work lands on self-healing/observability with no coverage or mutation signal; regressions ship; they surface only in a consumer's production test run.
- **Mitigation:** Treat the rest of this register as a _rebalancing program_, not a checklist — redirect existing capacity (the same rigor that built the observability stack) onto the under-tested risk surfaces; freeze platform expansion until R1–R4 close.
- **Effort:** Program-level (drives §21–§23). **Owner:** Maintainer / QE lead.

### R1 — The flagship behavior (guarded auto-apply) is never proven end-to-end

- **Severity:** High · **Confidence:** High
- **Evidence:** Layers are verified in isolation but never composed: apply mechanics only at a lowered `SELF_HEAL_MIN_CONFIDENCE='0.3'` (`pageObjectBaseSelfHealing.spec.ts:206,269,…`); reachability only at `0.92` in the pure ranking function (`candidateScoring.spec.ts`); the one e2e runs `'suggest'` mode and asserts artifact _shape_ only (`self-healing-sat.spec.ts:46`). Default gate is `0.92` (`config.ts:11`). The project's own review names this its #1 finding and tracks DQ-003 (is `0.92` calibrated or placeholder?). Policy is intentional/ADR-backed (ADR-0001) — the gap is _integrated_ proof.
- **Impact:** The product is named for a capability no single test demonstrates working. A bootstrap paradox compounds it: positive history needs a successful apply, which needs confidence, which (for fresh candidates) needs history. Consumers enabling `guarded` may see nothing heal, or — if they lower the gate to make it fire — risk masking real regressions.
- **Escape scenario:** Consumer ships `guarded`, trusts auto-heal, selectors rot, nothing heals; discovered in production.
- **Mitigation:** One composed test that seeds a high-confidence registry record and drives `PageObjectBase.click` to a _successful_ guarded auto-heal at `0.92` against a realistic DOM (ties to R2); resolve DQ-003 in an ADR; document the registry warm-up lifecycle.
- **Effort:** M (3-5 days incl. fixture). **Owner:** Self-healing owner.

### R2 — The core value proposition (real-DOM resilience) is untested at fidelity; no real fixtures

- **Severity:** High · **Confidence:** High
- **Evidence:** All 6 e2e specs build DOM with `page.setContent(...)`; 17 assertions / 8 tests / 298 LOC; the only test data fixture in the tree is `SYNTHETIC_SECRET` — there are **no recorded HTTP fixtures, no fixture app, no golden files** (§3.3). `configs/playwright.config.ts testDir` points only at the synthetic examples.
- **Impact:** A framework selling "resilient page objects" never exercises a non-trivial DOM (shadow DOM, iframes, dynamic re-render, late-binding selectors) — exactly where self-healing and resilient locators are supposed to earn their value. The highest-fidelity band validates plumbing, not the product promise.
- **Escape scenario:** Resilience logic that works on flat synthetic DOM breaks on a real SPA; never caught pre-release.
- **Mitigation:** Stand up a version-pinned realistic fixture app and a proper fixture/page-object harness; migrate recovery + retry/timeout scenarios onto it; this is the substrate R1 also needs.
- **Effort:** M-L. **Owner:** QE.

### R3 — The strongest guarantees (Redis atomicity/CAS) are silently skippable

- **Severity:** High · **Confidence:** High
- **Evidence:** The exactly-once counter proof (120 concurrent observations) and concurrent-CAS winner proof live only in `redisIntegration.spec.ts`, gated by a `beforeAll` that _self-skips with a recorded reason_ when Docker/Testcontainers is unavailable. The memory-store conformance path does not exercise real Lua `EVAL`. No unit test covers `compareAndSetJsonVersion`/`atomicJsonMerge` (the `FakeRedisDriver` has no `eval`).
- **Impact:** The only defense against cross-run selector-registry corruption can vanish from a run without failing it. Since the registry promotes selectors across runs, an undetected atomicity regression could corrupt shared state for every consumer.
- **Escape scenario:** CI runner or local env lacks Docker → integration silently skips → an atomicity regression merges green.
- **Mitigation:** Make the Testcontainers Redis suite a _required_ CI job that **fails (not skips)** on `main` (GitHub runners provide Docker); add fast unit coverage of the CAS/merge reply-parsing paths.
- **Effort:** S (CI) + S (unit). **Owner:** Data owner.

### R4 — No evidence the tests catch regressions (coverage floor 5/40; no mutation/property testing)

- **Severity:** High · **Confidence:** High
- **Evidence:** `vitest.config.mts` floors exactly 5 modules; no `src/**` global threshold; `test:coverage` runs 7 named specs. No Stryker (mutation) or fast-check (property) anywhere (§4.2). The calibration-critical scoring/reachability is asserted at ~3 hand-picked candidates; retry/jitter/config parsing similarly point-sampled.
- **Impact:** ~72% of source (incl. all of observability, most of self-healing, `redisClient`, `selectorRegistry`) carries no coverage floor, and _even the floored modules_ have no proof their assertions detect mutations. The 0.92 calibration claim — load-bearing for safety — rests on point samples, not input-space evidence.
- **Escape scenario:** A refactor drops an error branch or inverts a scoring comparison; line-covered tests still pass; ships.
- **Mitigation:** Global coverage floor (start ~55%, ratchet) **plus** mutation testing scoped to self-healing scoring/guarded gate + data layer; property tests for scoring reachability, config parser, and retry/jitter.
- **Effort:** S (floor) + M (mutation/property). **Owner:** QE.

### R5 — Slow unit feedback loop _(secondary — productivity)_

- **Severity:** Medium · **Confidence:** High (measured) · **Evidence:** local `test:unit` = 237 tests in ~148.58s (import 209s cumulative vs tests 34s); `pre-push` runs it. **Impact:** erodes shift-left; contributors bypass. **Mitigation:** esbuild/swc transform, Vitest threads/sharding, or a fast pre-push subset. **Effort:** S-M. **Owner:** Tooling.

### R6 — Contract & security assertions verify shape, not effect _(secondary)_

- **Severity:** Medium · **Confidence:** Medium · **Evidence:** `security-secret-scan.contract.spec.ts` proves the gitleaks job is _wired_, not that a planted secret is _blocked_; integration Redis is unauthenticated (no TLS/auth path). **Impact:** a present-but-ineffective control still passes. **Mitigation:** negative test (planted `SYNTHETIC_SECRET` fails a local gitleaks run) + a TLS/auth Redis case. **Effort:** M. **Owner:** Security/QE.

### R7 — No artifact forward/backward-compatibility test _(secondary)_

- **Severity:** Medium · **Confidence:** Medium · **Evidence:** `v2::` candidate-ID scheme exists but no test reads legacy-format persisted records; no migration framework. **Impact:** schema/ID evolution could orphan registry/history data silently. **Mitigation:** prior-version artifact fixtures + assert graceful read/skip; document the policy. **Effort:** M. **Owner:** Data owner.

### R8 — Single-maintainer bus factor _(secondary — org)_

- **Severity:** Medium · **Confidence:** High · **Evidence:** sole owner `@jsugg`; CODEOWNERS is advisory unless branch protection requires code-owner review (state **[Unknown]**). **Impact:** knowledge concentration; safety paths can merge unreviewed. **Mitigation:** enable branch protection requiring review on `src/framework/selfHealing/`, `redisClient.ts`, `.github/`; onboard a second reviewer. **Effort:** S (config). **Owner:** Repo admin. _(Note: this is the correctly-sized home for the CODEOWNERS observation — a process control, not a top-line quality risk.)_

---

## 21. Recommendations

> **Scope constraint (binding).** Every recommendation below is deliberately confined to **test architecture, test infrastructure, and the test suite** — i.e., `tests/**`, `vitest.config.mts`, `configs/playwright.config.ts`, CI test/gate wiring under `.github/workflows/**`, and test-only dev-dependencies. **No `src/**`production code is modified and no new product functionality is added.** This is possible precisely because the codebase is already heavily dependency-injected (§5.3): retry takes`random`, the Redis client takes `createClient`/`sleep`/`env`, telemetry is swappable, repositories take `store`/`now` — so the framework can be exercised hard without changing it.
>
> **Compatibility with the implementation plan.** The repository has **just completed Phase 1** of `docs/ARCHITECTURE_IMPLEMENTATION_PLAN.md` (Release/API/privacy/documentation foundation, `AUR-IMPL-009`–`019`), which already shipped a **fixture contract** (`AUR-IMPL-013`), a **coverage/property/concurrency framework** (`AUR-IMPL-015`), the memory-store conformance baseline (`AUR-IMPL-017`), and the Playwright peer + OTLP coverage gates. These recommendations are therefore framed as **extending Phase 1 assets, not introducing parallel ones**. They are also explicitly bounded **not to preempt Phase 2** (`AUR-IMPL-020`–`027`: structured candidates, `AuroraFlowContext`, the page-action pipeline, promotion authorization), which is scheduled _codebase_ work. Where a clean fix needs production code (e.g., injecting an env/context into `PageObjectBase`), the QE program uses a **test-side interim** now and defers the structural change to its owning plan task — it never does Phase 2's refactors under the banner of "testing."
>
> **Sequencing principle.** This is a _rebalancing_ program (R0): the first job is to prove the flagship works and protect the risk surface — **not** to add platform scope. Recommendations are ordered so that the fidelity substrate (the fixture harness) is built once and reused downstream. A standing constraint runs through all horizons: **freeze new observability/platform machinery until the Immediate + Near-Term waves land.**

### Immediate (0-2 weeks) — prove the core and stop the silent bleeds

1. **Build the realistic fixture substrate (R2, blocks R1).** _Problem:_ no real fixtures; e2e is synthetic. _Change:_ a version-pinned fixture app (shadow DOM, iframe, dynamic re-render) + a Playwright fixture/page-object harness under `tests/suites/e2e`. _Benefit:_ the substrate every meaningful e2e and the R1 proof need. _Trade-off:_ upfront fixture authoring. _Validation:_ fixture app served deterministically in CI. _Dependencies:_ none — do this first.
2. **Prove guarded auto-apply at `0.92` end-to-end (R1).** _Change:_ on the new fixture, seed a high-confidence registry record and drive `PageObjectBase.click` to a _successful_ guarded heal at the shipped default; assert the action recovers and the artifact records `succeeded:true`. _Benefit:_ closes the single biggest credibility gap — "does the product actually do its one thing." _Validation:_ test fails if scoring/gate regresses; _no lowering the gate_. _Dependencies:_ #1.
3. **Make the atomicity proof mandatory (R3).** _Change:_ promote the Testcontainers Redis suite to a _required_ CI job on `main` that **fails (not skips)** without Docker; add fast unit tests for CAS/merge reply parsing. _Benefit:_ the data-integrity guarantee can no longer silently disappear. _Validation:_ CI red if the integration suite is skipped on `main`.
4. **Add a global coverage floor (R4, part 1).** _Change:_ `src/**` coverage job at ~55% lines/branches, ratchet quarterly, keeping the 5-module strict gate as the higher bar. _Benefit:_ immediately exposes the 0.60/0.78 under-tested surfaces; stops silent erosion on ~38 modules. _Validation:_ CI fails below floor.

### Near-Term (1-2 months) — measure assertion quality and harden the risk surface

5. **Mutation testing on the risk surface (R4, part 2).** _Change:_ Stryker scoped to self-healing scoring + guarded gate + data layer. _Benefit:_ proves the existing (well-crafted) assertions actually _catch_ regressions — converts LOC vanity into catch-rate evidence. _Trade-off:_ mutation runtime; scope tightly. _Validation:_ mutation score baseline committed; gate on no-regression.
6. **Property/fuzz tests for calibration-critical math (R1/R4).** _Change:_ fast-check over scoring reachability (fresh candidates stay < `0.92` across generated inputs), the self-healing config parser, and retry/jitter bounds. _Benefit:_ the safety-load-bearing `0.92` claim proven across input space, not 3 points. _Dependencies:_ none.
7. **Migrate recovery + retry/timeout scenarios onto the fixture app (R2).** Move the synthetic e2e to realistic DOM; add shadow-DOM/iframe recovery cases. _Dependencies:_ #1.
8. **Negative security + auth tests (R6).** Planted-`SYNTHETIC_SECRET` gitleaks failure; TLS/authenticated Redis integration case. _Benefit:_ controls verified by _effect_, not shape.
9. **Speed up the unit loop (R5).** swc/esbuild transform + Vitest sharding; target <45s so `pre-push` stays honest.

### Medium-Term (3-6 months) — rebalance to risk-proportionate and close data-lifecycle gaps

10. **Ratchet coverage toward risk-proportionality (R0).** Drive observability + self-healing branch coverage up until ratios stop being inverted; track the per-subsystem ratio as an explicit metric, not aggregate LOC.
11. **Artifact forward/backward-compat _tests_ (R7).** Author prior-version (`v2::`) artifact fixtures and assert graceful read/skip. _Scope note:_ the test fixtures are test-only and can be written now; the actual legacy-read _capability_ and schema upgraders are **plan-owned codebase work** (Phase 2 `AUR-IMPL-020`, Phase 3 `AUR-IMPL-031`) — this item delivers the regression net those tasks must pass, not the migration code.
12. **Supply the DQ-003 evidence (R1) — do not change the default.** Commit the reachability + property tests and a behavior-documenting test that encodes current `0.92` semantics. _The resolution of DQ-003 itself_ (keep `0.92` / lower / make dynamic) is a **decision gate `AUR-DEC-002`, owned by the architecture maintainer**, and any change to the default or a dynamic gate is _out of this test-only review's scope_.

### Long-Term (6+ months) — plan-owned / productization (explicitly outside the QE test-only scope)

> The items below require production code or new tooling/CI and therefore belong to the implementation plan, **not** to this review. They are listed only to show the QE work's downstream and to mark the gating order.

13. **Real publish path** (OIDC provenance, protected `release` env reviewers) — plan Phase 1 `AUR-IMPL-010` / Phase 5, deferred by `AUR-DEC-012`; gate on the QE-Now wave being green.
14. **Reduce bus factor structurally (R8):** second maintainer / onboarding runbook atop `AUR-IMPL-016`; _then_ enable required code-owner review on safety paths (low value while solo).
15. **Self-overhead performance benchmarks** for self-healing analysis + DOM-snapshot cost — plan Phase 3 `AUR-IMPL-030`/`033` (new tooling, not test hardening), justified _after_ the core is tested.

---

## 22. Target Quality Engineering Options

> All three options share one premise from R0: the problem is **mis-allocation, not under-tooling**. They differ in how far the rebalance goes, not in whether to add more platform machinery (none recommend that until the core is proven).

### Option A — Risk-Rebalancing _(recommended default)_

- **Summary:** Do not change the architecture or add scope. Redirect existing capacity to prove the flagship (R1) on a real fixture substrate (R2), make the atomicity proof mandatory (R3), and floor coverage (R4). Freeze observability/platform expansion.
- **Benefits:** Directly closes all four correctness-level risks at modest cost; converts the framework from "well-built but unproven at its core" to "proven where it matters." Preserves the genuinely strong existing work (contract band, reliability primitives, supply-chain security).
- **Costs:** ~3-5 engineer-weeks (fixture substrate dominates).
- **Risks:** Leaves assertion-catch-rate (mutation) and input-space (property) gaps for Near-Term; bus factor unaddressed (acceptable while solo).
- **Migration path:** Recommendations 1-4. No new tools beyond a fixture app.
- **Org implications:** Sustainable for a single maintainer; this is the floor for an honest `1.x`.

### Option B — Risk-Proportionate Maturation _(recommended target)_

- **Summary:** Option A **plus** mutation + property testing on the risk surface (R4 part 2 / R1), migrate e2e onto realistic DOM (R2), negative security/auth tests (R6), artifact-compat (R7), faster loop (R5), and a per-subsystem-ratio metric so allocation stays risk-proportionate.
- **Benefits:** Confidence that tests _catch_ regressions, that the `0.92` calibration holds across input space, and that real-DOM recovery works — i.e., the under-tested 72% becomes measurably governed.
- **Costs:** ~8-12 engineer-weeks; ongoing mutation/property runtime (scope tightly).
- **Risks:** Added CI time; needs discipline to keep mutation/property suites green.
- **Migration path:** A, then recommendations 5-12.
- **Org implications:** Best fit when a `1.x` publish or external adoption is on the horizon; benefits from a second maintainer.

### Option C — Productized Quality Platform

- **Summary:** Option B **plus** real provenance publish, multi-maintainer governance, self-overhead perf gates, consumer-facing quality dashboards, and possibly extracting the observability stack into an optional companion package (so the heavy stack stops inflating the core repo's surface).
- **Benefits:** Production-grade, multi-team-ready.
- **Costs:** Multi-month; requires more than one engineer.
- **Risks:** Over-investment if adoption stays low (**[Unknown]**); maintenance surface grows.
- **Migration path:** B, then recommendations 13-15.
- **Org implications:** Requires team growth and a product owner.

**Recommended:** **Option A immediately** (it is the minimum bar for the product to honestly claim its headline feature works), **targeting Option B** as the steady state. Trigger to commit to B: any of a planned `1.x` publish, confirmed external adoption, or a second maintainer. Rationale: the quality _architecture_ and _craftsmanship_ are already strong — the failure mode here is not "too few tools" but "rigor pointed at the wrong surfaces," so the recommended path is redirection, not expansion. Defer C until adoption justifies the platform surface.

---

## 23. Suggested Quality Roadmap (mapped onto `ARCHITECTURE_IMPLEMENTATION_PLAN.md` phases)

Rather than invent a parallel numbering, this roadmap **slots the QE work into the plan's existing phase cadence**. The principle that makes this clean: the _test-only_ QE work that needs no production code is front-loaded **now** (it extends the just-completed Phase 1 assets and can run before/alongside Phase 2 without conflict); the QE items that _require_ production code are not scheduled here at all — they are handed to the plan task that already owns that code, as a **test requirement** to land _with_ it. This is why the review never has to touch `src/`.

### 23.1 QE-Now — test-only hardening (extends completed Phase 1; no `src/` change, parallel-safe with Phase 2)

This is **Option A + the test-only half of Option B**, all executable against the current codebase because of its DI seams (§5.3):

| QE deliverable | Risk | Extends Phase 1 asset | Touches only |
| --- | --- | --- | --- |
| Realistic DOM fixture app + Playwright fixture/page-object harness | R2 | `AUR-IMPL-013` fixture _contract_ | `tests/suites/e2e/**` |
| Composed guarded-heal e2e at the shipped `0.92` gate (seed registry via public API) | R1 | `AUR-IMPL-002` reachability tests | `tests/**` (uses current public API) |
| Promote Redis integration to a **required, fail-not-skip** CI gate + fast CAS/merge reply-parse unit tests | R3 | `AUR-IMPL-005`/`017` atomicity + conformance | `.github/workflows/**`, `tests/**` |
| Global `src/**` coverage floor (~55%, ratchet) + per-subsystem-ratio metric | R4/R0 | `AUR-IMPL-015` coverage framework | `vitest.config.mts`, CI |
| Mutation testing (Stryker) scoped to self-healing scoring/gate + data layer | R4 | `AUR-IMPL-015` (adds the catch-rate dimension) | dev-dep + config + CI |
| Property/fuzz (fast-check) for scoring reachability, config parser, retry/jitter | R1/R4 | `AUR-IMPL-015` (adds the **property** dimension it names but only partly delivered) | `tests/**` |
| Negative security (planted `SYNTHETIC_SECRET`) + TLS/auth Redis integration cases | R6 | `AUR-IMPL-010`/`019` security & OTLP gates | `tests/**`, CI |
| Unit-loop speedup (swc transform / Vitest sharding) | R5 | — | `vitest.config.mts` |

_Interim for the `process.env` coupling (§5.3):_ isolate env in self-heal specs with Vitest's `vi.stubEnv` **in the tests** — do **not** refactor `PageObjectBase`. The structural fix is Phase 2's job (next).

**Exit for 23.1:** a single test proves a heal fires at `0.92` on realistic DOM; CI is red if the Redis suite skips on `main` or coverage drops below floor; mutation + property baselines committed for the risk surface; unit suite <45s. **Standing constraint:** no new observability/platform machinery until this exits.

### 23.2 Aligned to Phase 2 (`AUR-IMPL-020`–`027`) — test _requirements_ handed to plan-owned codebase work

These need production code that Phase 2 already schedules, so the QE review **specifies the tests that must ship with them**, it does not perform the refactor:

- **`AUR-IMPL-021` `AuroraFlowContext`:** when env/context becomes injectable, **replace the `vi.stubEnv` interim with constructor-injected env** and add the "two independent runtime contexts in one process" tests — this is where the §5.3/§8 coupling is _properly_ closed.
- **`AUR-IMPL-020` structured candidate model + schema legacy read:** carries the artifact forward/back-compat tests (R7) — author the prior-version (`v2::`) fixtures here, not as a standalone QE task.
- **`AUR-IMPL-023` lifecycle helper/fixture implementation:** the realistic fixture _harness_ from 23.1 becomes the consumer of the real lifecycle helper; teardown-idempotency tests land here.
- **`AUR-IMPL-024`/`025`/`026`:** failure-storm budget, promotion-authorization race, audit-retention tests — Phase 2 owns both code and tests; the QE review only flags them as required.

### 23.3 Aligned to Phase 3 (`AUR-IMPL-028`–`033`) — data evolution & right-sizing

- **`AUR-IMPL-030`/`033` benchmark:** self-overhead performance tests (self-healing analysis + DOM-snapshot cost) belong here — _not_ in the QE-now scope, since a benchmark harness is new tooling/CI, not test hardening of existing behavior.
- **`AUR-IMPL-031` schema repair/upgraders:** completes the R7 data-lifecycle story the 23.2 compat fixtures begin.

### 23.4 Decision gates & Phase 5 (plan-owned; QE supplies evidence only)

- **DQ-003 / `AUR-DEC-002` ("is `0.92` calibrated, lower, or dynamic?"):** a _decision_, owned by the plan's architecture maintainer. The QE program contributes the reachability + property evidence (23.1) and documents current behavior in tests; it does **not** change the default or implement a dynamic gate.
- **Publishing & companion-repo split:** plan Phase 1 (`AUR-IMPL-010`, deferred by `AUR-DEC-012`) and Phase 5 (`AUR-IMPL-038`–`040`); out of QE test-only scope, gated on 23.1 being green.
- **Required code-owner review on safety paths (R8):** repo-admin config atop the existing `AUR-IMPL-016` CODEOWNERS; low value while single-maintainer, so deferred with bus-factor resolution.

---

## 24. Open Questions for Stakeholders

1. **Reliability expectations:** What activation rate is _intended_ for guarded auto-heal — is `0.92` "registry-curated-only by design" (i.e., auto-heal should rarely fire on fresh DOM) or a placeholder to lower? (Resolves R1/DQ-003.) **[Unknown]**
2. **Release cadence & intent:** When is the first _published_ `1.x` planned, and should auto-apply be advertised as production-grade at that point? **[Unknown]**
3. **Adoption/scale:** How many consumer suites use (or will use) AuroraFlow, and at what test volume? (Drives R0 allocation and the Option-C platform decision — including whether the heavyweight observability stack is justified.) **[Unknown]**
4. **Compliance/regulatory:** Are there any compliance obligations (e.g., data residency for selector/DOM artifacts, retention)? The privacy/retention docs exist but the _requirement_ is unstated. **[Unknown]**
5. **SLA/SLO targets:** The SLO machinery exists — what are the _actual_ target values and who owns breach response? Is `SLO_ALERT_FAIL_ON_BREACH` meant to be `true` in production CI? **[Unknown]**
6. **Risk tolerance:** Is regression-masking by self-healing an acceptable risk at any setting, or must auto-apply always be opt-in per-suite? **[Unknown]**
7. **Branch protection:** Is branch protection / required-review actually enabled on `main`? (CODEOWNERS is advisory.) **[Unknown]**
8. **Bus factor:** Is a second maintainer planned? This gates Options B/C. **[Unknown]**

---

## 25. Appendix

### A. Files inspected (primary)

- **Build/config:** `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.mts`, `eslint.config.mjs`, `.prettierrc.json`, `commitlint.config.cjs`, `configs/playwright.config.ts`, `configs/quality/slo-alert-policy.json`.
- **Source (read in full or substantial part):** `src/index.ts`, `src/pageObjects/pageObjectBase.ts`, `src/helpers/helpers.ts`, `src/utils/redisClient.ts`, `src/utils/logger.ts`, `src/framework/selfHealing/{config,guardedValidation,suggestionEngine,candidateScoring,scoringPolicy}.ts`.
- **Tests:** `tests/suites/e2e/examples/self-healing-sat.spec.ts`, `tests/suites/integration/framework/data/redisIntegration.spec.ts`, `tests/suites/unit/framework/pageObjectBase/pageObjectBaseSelfHealing.spec.ts`, `tests/suites/contracts/workflows/security-secret-scan.contract.spec.ts`; counts surveyed across all `tests/suites/**`.
- **CI:** `.github/workflows/{ci,quality,security,examples,release,playwright-peer-matrix}.yml`, `.github/dependabot.yml`, `.github/CODEOWNERS`.
- **Governance/docs:** `docs/adr/0001-safety-first-self-healing.md`, `docs/architecture/phase-0-validation-baseline.md`, referenced findings in `docs/ARCHITECTURE_REVIEW.md` / `ARCHITECTURE_IMPROVEMENT_PLAN.md` / `ARCHITECTURE_IMPLEMENTATION_PLAN.md` / `docs/architecture/self-healing.md` / `docs/configuration.md`.
- **Hooks:** `.husky/{pre-commit,commit-msg,pre-push}`.

### B. Commands run (read-only / verification)

- `git log --oneline -20`, `git branch --show-current`
- `find` over `src/`, `tests/`, `scripts/`, `.github/`, `configs/`, `docs/`, `schemas/`
- `wc -l` over source and tests; `grep` for `it/test` blocks, `process.env`, `catch`, `TODO/FIXME`, `eslint-disable`/`@ts-ignore`/`as any`, `0.92`, guarded-auto-heal references
- `npm run test:unit` → **41 files / 237 tests passed in 148.58s** (the single executed test command)

### C. Test assets inspected

Synthetic-secret fixtures (`tests/fixtures/privacy/syntheticSecrets.ts`); shared conformance (`selectorStoreConformance.ts`); API-surface helper (`apiStabilitySurface.ts`); `CapturingTelemetry` fake; 10 JSON Schemas in `schemas/`.

### D. CI workflows inspected

All six (see §A). Key facts: all actions SHA-pinned; `persist-credentials: false` everywhere; per-job least-privilege `permissions`; aggregator gate jobs (`security-gate`, self-heal governance); path-filter preflights; publishing intentionally disabled.

### E. Search queries used

`process.env`, `catch`, `TODO|FIXME|HACK|XXX`, `eslint-disable|@ts-ignore|@ts-expect-error|as any`, `guardedAutoHeal|self_healed|succeeded: true`, `SELF_HEAL_MODE`, `0.92`, `(it|test|describe)(` within tests.

### F. Assumptions

- The locally-run unit suite reflects CI behavior (CI uses the same `test:unit` script across Node 20/22/24).
- "Product" = the framework/library itself; "users" = consuming test suites/teams.
- Branch-protection and real-world adoption are not inferable from repo contents and are treated as Unknown rather than assumed.

### G. Unknowns (consolidated)

Adoption/scale; intended auto-heal activation semantics (DQ-003); publish timeline; compliance obligations; concrete SLO targets & ownership; branch-protection enablement; second-maintainer plans. (See §24.)

### H. Glossary

- **SAT** — Self-healing Analysis/snapshot (DOM candidate extraction + scoring on failure).
- **Guarded mode** — self-heal mode that dry-run-validates candidates and may auto-apply the first confidence- and policy-eligible locator, retrying once and preserving the original failure on retry failure.
- **CAS** — compare-and-set; here a server-side Redis Lua `EVAL` for atomic versioned writes.
- **Contract test (here)** — a Vitest spec asserting structural invariants of the repo's own CI/docs/package/infra (not consumer-driven contract testing).
- **SLO/SLI** — service-level objective/indicator; AuroraFlow models test-quality SLIs (e.g., flakiness, failure rate) into a dashboard + alert policy.
- **Reachability** — whether a candidate's computed confidence can meet the guarded gate; unit-proven for registry/history paths, unproven end-to-end at the default.

---

### Final quality-gate self-check (per task instructions)

- Major conclusions are evidence-backed with file/line or command citations; each is tagged Observed / Inferred / Unknown.
- Unsupported areas (adoption, SLO targets, branch protection, publish timeline, compliance) are explicitly labeled Unknown, not guessed.
- The Quality Fitness section (§18) is prominent and repository-specific (cites AuroraFlow's actual modules, ADRs, and measured metrics).
- Recommendations (§21) follow from the risk register (§20), are prioritized/sequenced, and are **bounded to test architecture, test infrastructure, and the test suite** — no `src/` change and no new product functionality (§21 scope banner).
- The roadmap (§23) is **mapped onto `ARCHITECTURE_IMPLEMENTATION_PLAN.md` phases**: test-only QE work extends the completed Phase 1; items needing production code are handed to their owning Phase 2/3 plan tasks rather than scheduled here.
- Only this documentation file was created; no production code was modified.
