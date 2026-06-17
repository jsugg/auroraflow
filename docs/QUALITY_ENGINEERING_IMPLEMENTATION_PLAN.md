# Quality Engineering Implementation Plan

## 1. Executive Summary

This plan replaces the earlier QE backlog with a current, audit-driven remediation plan aligned to `docs/ARCHITECTURE_IMPLEMENTATION_PLAN.md`.

Current repository state is materially stronger than the original QE review described:

- Realistic E2E fixture app exists under `tests/fixtures/e2e-app/`.
- Guarded self-heal is proven in Chrome at the shipped default confidence gate (`0.92`) through `test:e2e:guarded`.
- Redis/Testcontainers integration can be required in CI via `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true`.
- Global `src/**` coverage exists alongside critical-module thresholds.

The remaining QE problem is no longer "missing the core proof." It is now:

1. **Isolation debt:** self-healing tests mutate `process.env` and shared artifact folders, blocking safe parallelism.
2. **Signal-quality debt:** many contract tests assert strings in docs/workflows instead of parsed semantics or effects.
3. **Risk-weighted coverage debt:** global coverage passes while critical modules remain weakly covered.
4. **Gate-topology debt:** scripts and workflows mix fast/slow/static/Docker/browser/security concerns in ways that slow feedback and obscure failures.
5. **Architecture-sequencing debt:** iframe recovery, env isolation, lifecycle fixtures, artifact compatibility, and failure-path performance must land with the architecture Phase 2/3 seams, not as ad hoc patches.

This plan is executable. Each task below names concrete files, dependencies, validation commands, and acceptance criteria.

## 2. Evidence Sources

Primary audit report:

- `.serena/testing-best-practices-issues.md`

Repository files inspected:

- `package.json`
- `vitest.config.mts`
- `configs/vitest.coverage-global.mts`
- `configs/playwright.config.ts`
- `.github/workflows/*.yml`
- `.husky/*`
- `scripts/*`
- `tests/**`
- `coverage/coverage-summary.json`
- `docs/development.md`
- `docs/writing-tests.md`
- `docs/QUALITY_ENGINEERING_REVIEW.md`
- `docs/ARCHITECTURE_IMPLEMENTATION_PLAN.md`

Key source symbols inspected:

- `PageObjectBase` in `src/pageObjects/pageObjectBase.ts`
- `resolveLocatorExpression()` in `src/framework/selfHealing/guardedValidation.ts`
- `RedisClient` in `src/utils/redisClient.ts`
- `OtelTelemetry` in `src/framework/observability/otelTelemetry.ts`

## 3. Current Test Architecture Baseline

| Band | Current files | Current role | Preserve | Fix |
| --- | --: | --- | --- | --- |
| Unit | 41 specs | Fast framework logic | Typed fakes, deterministic clock/RNG seams, telemetry capture helper | Env mutation in page-object self-heal tests; missing high-risk adapter coverage |
| Integration | 2 specs | Redis/Testcontainers and OTLP export | Real Redis CAS/history/promotion evidence; required-mode env | Split from contracts; avoid running Docker on every Node matrix lane |
| Contracts | 17 specs | Package/workflow/docs/infra invariants | API surface contract, SHA-pinned action guard, workflow/security guardrails | Replace brittle raw string checks with parsed/effect checks |
| E2E | 8 specs | Browser smoke, examples, guarded proof | Fixture app, guarded default-gate proof, smoke tags | Shared artifacts/env, iframe fixme, PR risk lane |
| Scripts | 14 files | Reports, governance, schemas, observability | TypeScript CLIs with clear outputs | Add process-level success/failure tests; add `schemas:check` to required gates |

## 4. Non-Negotiable QE Principles

1. No new self-healing behavior without an observable-effect test and artifact/telemetry assertion.
2. No global mutable state in tests unless a suite is explicitly serial and no parallel-safe seam exists yet.
3. No new raw Markdown/YAML string contract unless the string is a public compatibility/safety invariant and the test states why.
4. No broad platform/observability expansion to compensate for missing core test proof.
5. Coverage thresholds must follow risk, not aggregate vanity percentages.
6. Docker/browser/full-stack gates must be explicit and separable from fast local/unit gates.
7. Local and CI gate names must say what they actually run.
8. Any `test.fixme` must name the blocking task and have a removal acceptance criterion.

## 5. Architecture Phase Alignment

| QE phase | Architecture alignment | Purpose | Must happen before |
| --- | --- | --- | --- |
| QE-0: Baseline + docs sync | Current Phase 1 closeout | Freeze current audit facts and remove stale QE plan wording | Any new QE implementation PR |
| QE-1: Gate hygiene + deterministic paths | Before/alongside Architecture Phase 2 | Script taxonomy, stale globs, schema checks, artifact dir isolation, CI split | Large runtime refactors |
| QE-2: Runtime isolation + assertion quality | Architecture Phase 2 (`AUR-IMPL-020`-`027`) | Structured candidates, `AuroraFlowContext`, lifecycle fixture, mutation/property, semantic contracts | Phase 3 data/observability modernization |
| QE-3: Data/schema/observability/perf hardening | Architecture Phase 3 (`AUR-IMPL-028`-`033`) | Artifact compatibility, Redis auth/TLS/repair, typed observability validators, perf baseline | Release readiness |
| QE-4: Release governance | Architecture Phase 4/5 | Required checks, publish readiness, owner decisions | Real npm publish |

## 6. Completed Baselines to Preserve

These items are now treated as baseline evidence, not open tasks:

- `tests/fixtures/e2e-app/**` plus `scripts/e2e-fixture-server.mjs` provide a real HTTP fixture with guarded, dynamic, shadow DOM, and iframe controls.
- `tests/suites/e2e/fixtures/guarded-self-healing.spec.ts` proves guarded auto-apply at default `0.92` for registry candidates and rejects fresh DOM candidates at default gate.
- `tests/suites/integration/framework/data/redisIntegration.spec.ts` supports `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true`.
- `configs/vitest.coverage-global.mts` and `test:coverage` provide global plus critical coverage.
- `tests/helpers/selectorStoreConformance.ts` is the baseline for memory/Redis store behavior.
- QE-01B split Node compatibility from Docker/browser-heavy gates: Node 20/22/24 now runs lint, typecheck, and unit tests only; Node 22 owns repository contracts, Redis-required integration, schemas, ShellCheck, workflow lint, and coverage; guarded Chrome proof remains separate.
- `AUR-QE-105`: self-healing tests use typed Playwright/Vitest artifact scopes, write artifacts through `SELF_HEAL_ARTIFACTS_DIR`, and scope evidence reads by per-test root plus run/test ID; guarded Chrome proof runs with two workers.

Do not weaken these to make future work easier.

## 7. Task Backlog

| Task ID | Title | Phase | Priority | Related findings | Architecture dependency | Primary files |
| --- | --- | --- | --- | --- | --- | --- |
| `AUR-QE-101` | Correct test script taxonomy | QE-1 | P0 | TQE-001, TQE-012 | none | `package.json`, docs |
| `AUR-QE-102` | Remove stale suite globs and unsafe pass-with-no-tests | QE-1 | P0 | TQE-011 | none | `package.json`, Vitest configs |
| `AUR-QE-103` | Add schema validation to required gates | QE-1 | P0 | TQE-009 | none | `package.json`, workflows |
| `AUR-QE-104` | Split CI matrix from Docker/browser heavy gates | QE-1 | P0 | TQE-010, TQE-013 | none | `.github/workflows/quality.yml` |
| `AUR-QE-105` | Isolate self-healing artifact directories | QE-1 | P0 | TQE-003 | none; improves with `AUR-IMPL-021` | E2E/unit self-heal specs |
| `AUR-QE-106` | Update developer testing docs | QE-1 | P1 | TQE-015 | `101`-`104` | `docs/development.md`, `docs/writing-tests.md` |
| `AUR-QE-107` | Replace brittle contract text assertions | QE-1/2 | P1 | TQE-007, TQE-016 | none | `tests/suites/contracts/**` |
| `AUR-QE-108` | Add effect-level security checks | QE-2 | P1 | TQE-008, TQE-020 | none | security workflow/contracts |
| `AUR-QE-109` | Add risk-weighted coverage floors | QE-2 | P0 | TQE-005 | possible OTel seams | coverage configs, unit specs |
| `AUR-QE-110` | Add scoped mutation/property baseline | QE-2 | P1 | TQE-006 | dependency approval if needed | package/tests |
| `AUR-QE-111` | Remove `process.env` coupling from self-healing tests | QE-2 | P0 | TQE-002 | `AUR-IMPL-021` | `PageObjectBase`, self-heal specs |
| `AUR-QE-112` | Unfix iframe guarded recovery through structured candidates | QE-2 | P0 | TQE-004 | `AUR-IMPL-020` | guarded validation/E2E |
| `AUR-QE-113` | Implement lifecycle fixture cleanup tests | QE-2 | P1 | TQE-002, TQE-003 | `AUR-IMPL-023` | `auroraflow/playwright` tests |
| `AUR-QE-114` | Add flake governance and PR risk E2E lane | QE-2 | P2 | TQE-013, TQE-017 | SLO owner decision | workflows/report scripts |
| `AUR-QE-115` | Add CLI boundary tests for CI scripts | QE-2 | P1 | TQE-018 | none | `scripts/**`, new tests |
| `AUR-QE-116` | Add versioned artifact compatibility fixtures | QE-3 | P1 | TQE-014 | `AUR-IMPL-029` | fixtures/schemas/docs |
| `AUR-QE-117` | Convert observability workflow grep checks to typed validators | QE-3 | P1 | TQE-016 | `AUR-IMPL-031` optional | scripts/workflows/contracts |
| `AUR-QE-118` | Add failure-path and DOM snapshot performance baseline | QE-3 | P2 | TQE-005, TQE-017 | `AUR-IMPL-032` | benchmarks/tests/docs |

## 8. Detailed Task Cards

### `AUR-QE-101 — Correct test script taxonomy`

- **Objective:** Make script names map to real cost and scope.
- **Current state:** Implemented by QE-01A: `npm test` delegates to unit tests, `test:contracts` owns contract specs, and `test:integration` owns Redis/Testcontainers plus OTLP integration specs.
- **Implementation steps:**
  1. Change `test` to `npm run test:unit`.
  2. Add `test:contracts`.
  3. Make `test:integration` run only `tests/suites/integration`.
  4. Add `test:integration:all` or update `verify` to call `test:integration` and `test:contracts`.
  5. Update docs and workflow contract tests.
- **Validation commands:**
  - `npm test`
  - `npm run test:integration`
  - `npm run test:contracts`
  - `npm run verify`
- **Acceptance criteria:**
  - `npm test` does not require browsers or Docker.
  - Contract failures and Redis/OTLP integration failures are separated in CI logs.
  - Docs show command cost tiers.

### `AUR-QE-102 — Remove stale suite globs and unsafe pass-with-no-tests`

- **Objective:** Ensure missing/moved test suites fail loudly.
- **Current state:** Implemented by QE-01A: canonical scripts/config removed obsolete suite references and unsafe no-test pass-through; a contract proves missing suite paths fail loudly.
- **Implementation steps:**
  1. Remove obsolete framework-suite references from all scripts/config/docs.
  2. Remove unsafe no-test pass-through from `vitest.config.mts`.
  3. Remove no-test pass-through flags from canonical scripts.
  4. Keep optional no-test behavior only for explicitly optional scripts, if any.
- **Validation commands:**
  - `npm run test:unit`
  - `npm run test:coverage`
  - `npm run verify`
- **Acceptance criteria:**
  - A misspelled suite path fails.
  - No stale framework-suite reference remains.

### `AUR-QE-103 — Add schema validation to required gates`

- **Objective:** Make artifact schema integrity part of canonical verification.
- **Current state:** Implemented by QE-01A: `verify` requires `schemas:check`, and the release dry-run records schema validation output in release evidence.
- **Implementation steps:**
  1. Add `npm run schemas:check` to `verify` or a required `verify:schema` script.
  2. Add schema validation evidence to release dry-run.
  3. After artifact-producing jobs, validate generated artifacts when directories exist.
  4. Update workflow contract tests semantically.
- **Validation commands:**
  - `npm run schemas:check`
  - `npm run verify`
  - `npm run workflows:lint`
- **Acceptance criteria:**
  - Broken schema compilation fails required validation.
  - Release dry-run evidence includes schema validation.

### `AUR-QE-104 — Split CI matrix from Docker/browser heavy gates`

- **Objective:** Preserve compatibility evidence while reducing duplicated Docker/browser work.
- **Current state:** Implemented by QE-01B: `quality.yml` separates `Node Compatibility (Node 20/22/24)`, `Repository Gates (Node 22)`, `Coverage (Critical + Global)`, `Guarded Self-Heal Proof (Chrome)`, and path/label-triggered `Risk-Triggered E2E (Chrome)`.
- **Implementation steps:**
  1. In `quality.yml`, make Node 20/22/24 matrix run install + lint + typecheck + unit.
  2. Run Redis integration/contracts once on Node 22 with `AURORAFLOW_REDIS_INTEGRATION_REQUIRED=true`.
  3. Keep coverage on Node 22.
  4. Keep guarded self-heal proof as separate Chrome job.
  5. Add a PR label/path-triggered full E2E lane for risky browser/runtime changes.
- **Validation commands:**
  - `npm run workflows:lint`
  - `npm run test:integration`
  - `npm run test:contracts`
- **Acceptance criteria:**
  - Redis required evidence still blocks PR/main at least once.
  - Node compatibility remains proven.
  - CI job names identify exact gate responsibility.

### `AUR-QE-105 — Isolate self-healing artifact directories`

- **Objective:** Remove shared filesystem race risk from self-healing tests.
- **Current state:** Implemented by QE-01C: `tests/helpers/selfHealingArtifacts.ts` provides typed per-test artifact scopes; Playwright tests use `testInfo.outputPath()`, Vitest uses `mkdtemp`, and no self-healing test deletes the shared `test-results/self-healing` directory.
- **Implementation steps:**
  1. Create typed test helper for per-test artifact roots.
  2. Use `testInfo.outputPath()` in Playwright and `mkdtemp` in Vitest.
  3. Stop deleting `test-results/self-healing` in tests.
  4. Scope artifact lookup by current test root and run/test ID.
  5. Run self-healing E2E with multiple workers where practical.
- **Validation commands:**
  - `npm run test:e2e:guarded`
  - `npm run test:e2e -- --project='Google Chrome' --grep self-healing --workers=2`
  - `npm run test:unit -- --run tests/suites/unit/framework/pageObjectBase/pageObjectBaseSelfHealing.spec.ts`
- **Acceptance criteria:**
  - No test calls `rm` on shared `test-results/self-healing`.
  - Parallel self-healing tests do not delete each other's evidence.

### `AUR-QE-106 — Update developer testing docs`

- **Objective:** Keep contributor docs aligned with real commands and gates.
- **Current state:** Implemented by QE-01B: developer docs describe command names, cost tiers, local vs CI gates, Redis skip/required behavior, guarded Chrome proof, and critical/global/future risk-weighted coverage guidance.
- **Implementation steps:**
  1. Update test layout table.
  2. Add local vs CI gate table.
  3. Explain Redis skip vs required fail behavior.
  4. Explain critical + global + future risk-weighted coverage.
- **Validation commands:**
  - `npm run format:check`
  - `npm run test:contracts -- tests/suites/contracts/docs/documentationSurface.contract.spec.ts`
- **Acceptance criteria:**
  - Docs contain no nonexistent suite paths.
  - Docs do not say coverage is focused-only after global coverage exists.

### `AUR-QE-107 — Replace brittle contract text assertions`

- **Objective:** Improve contract signal and reduce maintenance drag.
- **Current state:** Implemented. Contract specs use no raw `toContain`/`toMatch` and no bare boolean `toBe(true)`/`toBe(false)`; workflow/Compose/JSON checks use parsed models, and every remaining protected text check goes through `tests/helpers/contractAssertions.ts` with explicit safety or compatibility rationale. The `test-taxonomy` contract enforces this by failing when any `tests/suites/contracts/**` spec uses a raw text matcher or a bare boolean assertion.
- **Implementation steps:**
  1. Inventory raw `toContain` checks in `tests/suites/contracts/**`.
  2. Classify each as public compatibility, safety invariant, or low-value wording.
  3. Replace workflow/JSON/Compose checks with parsed semantics where practical.
  4. Delete wording checks that do not protect compatibility/safety.
  5. Add a helper/rule requiring rationale for new raw text checks.
- **Validation commands:**
  - `npm run test:contracts`
  - `npm run workflows:lint`
- **Acceptance criteria:**
  - Contract failures report semantic invariants.
  - Markdown prose checks are rare and justified.

### `AUR-QE-108 — Add effect-level security checks`

- **Objective:** Prove security controls catch representative failures.
- **Implementation steps:**
  1. Split `security:audit`, `security:workflows`, and `security:all`.
  2. Update `security.yml` so npm audit job does not run `zizmor`.
  3. Add temp synthetic-secret scanner test or scheduled effect job.
  4. Keep SHA-pinned workflow contract.
- **Validation commands:**
  - `npm run security:audit`
  - `npm run security:workflows`
  - Targeted security contract test
- **Acceptance criteria:**
  - Synthetic secret check fails when scanner is disabled/misconfigured.
  - CI jobs have single clear ownership.

### `AUR-QE-109 — Add risk-weighted coverage floors`

- **Objective:** Stop global coverage from hiding high-risk holes.
- **Implementation steps:**
  1. Add baseline thresholds for:
     - `src/framework/observability/otelTelemetry.ts`
     - `src/framework/selfHealing/domSnapshot.ts`
     - `src/utils/redisClient.ts`
     - `src/data/selectors/redisSelectorStore.ts`
     - `src/framework/selfHealing/promotionWorkflow.ts`
  2. Add fast unit tests before raising thresholds.
  3. Keep global thresholds as erosion guard.
  4. Document any file excluded from thresholds with reason and expiry.
- **Validation commands:**
  - `npm run test:coverage`
  - Targeted unit tests for added modules
  - `npm run typecheck`
- **Acceptance criteria:**
  - No listed high-risk file remains at 0% or single-digit line coverage.
  - Threshold failures are actionable.

### `AUR-QE-110 — Add scoped mutation/property baseline`

- **Objective:** Measure assertion catch-rate for calibration-critical code.
- **Implementation steps:**
  1. Choose Stryker/fast-check or deterministic in-repo generator approach.
  2. Scope first mutation run to scoring/config/guarded validation/retry/Redis CAS.
  3. Add fixed seeds and bounded case counts for property tests.
  4. Run as scheduled/manual first if runtime is high.
  5. Gate on no-regression once baseline stabilizes.
- **Validation commands:**
  - `npm run test:unit`
  - New mutation/property script
- **Acceptance criteria:**
  - Baseline is recorded.
  - Critical surviving mutants are not ignored.
  - Property failures are reproducible from seed.

### `AUR-QE-111 — Remove process.env coupling from self-healing tests`

- **Objective:** Make self-healing tests parallel-safe and context-isolated.
- **Architecture dependency:** `AUR-IMPL-021`.
- **Implementation steps:**
  1. Add/use `AuroraFlowContext` with env-backed defaults.
  2. Inject self-healing config, registry runtime, privacy policy, telemetry, artifact root.
  3. Update page-object self-healing tests to use contexts.
  4. Add two-context isolation test.
- **Validation commands:**
  - `npm run test:unit -- --run tests/suites/unit/framework/pageObjectBase`
  - `npm run test:e2e:guarded`
  - `npm run typecheck`
- **Acceptance criteria:**
  - Self-healing specs no longer write `process.env`.
  - Public constructors remain compatible.

### `AUR-QE-112 — Unfix iframe guarded recovery through structured candidates`

- **Objective:** Turn the current iframe fixme into passing behavior.
- **Architecture dependency:** `AUR-IMPL-020`.
- **Implementation steps:**
  1. Add frame-aware candidate representation.
  2. Preserve legacy string artifact read path.
  3. Replace string parser dependency in guarded validation.
  4. Enable iframe guarded E2E.
- **Validation commands:**
  - `npm run test:e2e:guarded`
  - `npm run test:unit -- --run tests/suites/unit/framework/selfHealing/guardedValidation.spec.ts`
  - `npm run test:coverage`
- **Acceptance criteria:**
  - No `test.fixme` remains for iframe guarded recovery.
  - Candidate model tests cover frame locators and legacy reads.

### `AUR-QE-113 — Implement lifecycle fixture cleanup tests`

- **Objective:** Prove planned `closeAuroraFlow(context?)` and `auroraflow/playwright` cleanup semantics.
- **Architecture dependency:** `AUR-IMPL-023` after `AUR-IMPL-021`.
- **Implementation steps:**
  1. Add lifecycle unit tests for idempotent close, concurrent close, reverse disposer order, aggregate errors, disabled-subsystem no-ops.
  2. Add Playwright fixture tests proving per-test cleanup of telemetry/Redis/artifact context.
  3. Keep Playwright `Page`/`BrowserContext` consumer-owned.
- **Validation commands:**
  - `npm run test:unit`
  - `npm run test:e2e -- --project='Google Chrome' --grep lifecycle`
  - `npm run typecheck`
- **Acceptance criteria:**
  - Cleanup runs at most once per context.
  - Failures surface without skipping remaining disposers.

### `AUR-QE-114 — Add flake governance and PR risk E2E lane`

- **Objective:** Convert flake reporting into ownership and risk-triggered evidence.
- **Implementation steps:**
  1. Define flake triage policy and owner fields.
  2. Add PR label/path-triggered full E2E workflow option.
  3. Ensure quarantined tests remain visible in reports.
  4. Keep default PR fast.
- **Validation commands:**
  - `npm run workflows:lint`
  - `npm run flakiness:report` against fixture report data
- **Acceptance criteria:**
  - Risky PRs can run full browser matrix before merge.
  - Repeated flakes create actionable triage output.

### `AUR-QE-115 — Add CLI boundary tests for CI scripts`

- **Objective:** Test script process behavior, not only imported functions.
- **Implementation steps:**
  1. Add temp-dir fixtures for `flakiness-report`, `slo-dashboard`, `slo-alerts`, `schemas-check`, promotions, and cleanup scripts.
  2. Spawn scripts with success and expected-failure args.
  3. Assert exit code and actionable stderr/stdout.
  4. Keep tests fast and deterministic.
- **Validation commands:**
  - Targeted new script-boundary specs
  - `npm run test:unit`
  - `npm run typecheck`
- **Acceptance criteria:**
  - Every workflow-invoked script has process-level success and failure coverage.

### `AUR-QE-116 — Add versioned artifact compatibility fixtures`

- **Objective:** Protect CI/report consumers from artifact drift.
- **Architecture dependency:** `AUR-IMPL-029` for full schema versioning/repair.
- **Implementation steps:**
  1. Add `tests/fixtures/artifacts/v1/**`.
  2. Define compatibility policy in `docs/operations/artifact-schemas.md`.
  3. Add tests for must-read, skip-with-warning, and hard-reject cases.
  4. Use fixtures in schema and parser tests.
- **Validation commands:**
  - `npm run schemas:check`
  - Artifact schema/unit tests
- **Acceptance criteria:**
  - Legacy artifact behavior is explicit and automated.

### `AUR-QE-117 — Convert observability workflow grep checks to typed validators`

- **Objective:** Replace shell text checks with typed JSON/API validation.
- **Implementation steps:**
  1. Move Prometheus/Grafana/Jaeger/Elasticsearch/Kibana checks into Node validator(s).
  2. Keep workflow as orchestration only.
  3. Upload validator JSON diagnostics.
  4. Reduce observability contract string assertions to "workflow calls validator" and config invariants.
- **Validation commands:**
  - `npm run test:unit -- --run tests/suites/unit/framework/observability`
  - `npm run workflows:lint`
  - Scheduled/manual full-stack smoke
- **Acceptance criteria:**
  - Backend failures identify exact missing series/query/service.
  - Contract tests no longer mirror dozens of workflow grep strings.

### `AUR-QE-118 — Add failure-path and DOM snapshot performance baseline`

- **Objective:** Measure overhead before any hard performance gate.
- **Architecture dependency:** `AUR-IMPL-032`.
- **Implementation steps:**
  1. Build deterministic failure fixture.
  2. Measure safe-action failure path, DOM snapshot, SAT candidate extraction, artifact write.
  3. Record baseline in docs/artifact.
  4. Add warning-only regression report initially.
- **Validation commands:**
  - New performance smoke script
  - `npm run test:e2e:guarded`
- **Acceptance criteria:**
  - Baseline exists and is reproducible.
  - No hard gate is added before maintainer accepts budget.

## 9. Required Gate Model

### Local fast path

Must avoid Docker/browser by default:

```bash
npm test
npm run lint
npm run typecheck
```

### PR required path

Target required jobs:

- Format check.
- Lint.
- Typecheck on Node 20/22/24.
- Unit tests on Node 20/22/24.
- Contracts once on Node 22.
- Redis/OTLP integration once on Node 22.
- Critical + global + risk-weighted coverage once on Node 22.
- Guarded self-heal Chrome proof.
- Workflow lint.
- ShellCheck.
- Schema check.
- Security gate with split ownership.

### PR risk-triggered path

Run when label/path requires:

- Full or partial cross-browser E2E.
- Mutation/property baseline.
- Full observability smoke.

### Scheduled/manual path

- Full E2E matrix across browsers/devices.
- Playwright peer matrix.
- Full observability stack.
- Remote observability export if secrets configured.
- Mutation testing if too slow for PR.

### Release dry-run path

Must include all PR required gates plus:

- Build.
- Pack dry-run.
- SBOM.
- Provenance readiness.
- Schema validation.
- Guarded self-heal proof.
- Artifact compatibility checks.

## 10. Acceptance Criteria for Plan Completion

This QE plan is complete when:

1. `npm test` is fast and deterministic.
2. No canonical test script includes nonexistent suite paths.
3. `schemas:check` is required.
4. Self-healing tests do not share artifact roots or mutate global env after context work lands.
5. Iframe guarded recovery is either passing or blocked only by an accepted structured-candidate task with visible failing/fixme status.
6. Contract tests primarily assert parsed/effect-level invariants.
7. High-risk modules have explicit coverage thresholds or documented temporary exemptions.
8. Mutation/property baseline exists for scoring/config/guarded validation/retry/CAS.
9. CI separates fast, Docker, browser, security, and release evidence.
10. Developer docs match the implemented commands and paths.

## 11. Open Decisions

| Decision | Default until resolved | Blocks |
| --- | --- | --- |
| Should mutation testing add Stryker, use Vitest-only mutation tooling, or use custom seeded generators first? | Start scheduled/manual with smallest dependency footprint. | Required mutation gate |
| Should PR full E2E be label-triggered, path-triggered, or required for all runtime PRs? | Path-triggered plus manual label. | `AUR-QE-114` |
| Who owns SLO/flake fail-on-breach policy? | Warn-only with triage output. | Hard flake/SLO gate |
| What artifact versions must remain readable after `AUR-IMPL-029`? | Preserve current public schemas; skip unknown future versions with warning. | `AUR-QE-116` |

## 12. Reviewer Checklist for QE PRs

- [ ] Test added or updated before behavior/gate change where practical.
- [ ] No new global env mutation or shared artifact root.
- [ ] No new raw Markdown/YAML string assertion without rationale.
- [ ] Fast and expensive validations are named separately.
- [ ] CI job names match actual work.
- [ ] Coverage changes do not weaken existing critical thresholds.
- [ ] Docs updated for public script/gate behavior.
- [ ] Architecture task dependency respected.
- [ ] Validation commands and results recorded in PR description.

### Suggested future prompts for coding-agent execution

The prompts below are the complete execution sequence for this plan: every task `AUR-QE-101` through `AUR-QE-118` is executed by exactly one prompt, grouped and ordered by the Section 5 phase alignment and Section 7 backlog. Run them in order unless an architecture dependency explicitly requires waiting for the named `AUR-IMPL-*` task. Every prompt implicitly includes the Section 4 QE principles and Section 12 reviewer checklist: read this plan, `.serena/testing-best-practices-issues.md`, and `docs/ARCHITECTURE_IMPLEMENTATION_PLAN.md` first; preserve Section 6 completed baselines; update docs and workflow contract tests when public commands or gates change; run the task-card validation commands; record validation results in the PR description; and stop rather than weakening safety, coverage, required gates, or browser/Redis proof.

QE-01A (QE-1) — fast-gate taxonomy and schema gate:

```text
Execute AUR-QE-101, AUR-QE-102, and AUR-QE-103 from docs/QUALITY_ENGINEERING_IMPLEMENTATION_PLAN.md. Make npm test unit-only, split contracts from Redis/OTLP integration, remove stale suite globs and pass-with-no-tests from canonical paths, and add schemas:check to required verification/release evidence. Keep docs and workflow contract tests semantic, and prove missing suite paths fail loudly.
```

QE-01B (QE-1) — CI gate topology and contributor docs:

```text
Execute AUR-QE-104 and AUR-QE-106. Requires QE-01A complete. Split Node compatibility from Docker/browser-heavy gates, keep Redis required-mode evidence blocking once on Node 22, preserve guarded Chrome proof, and update developer docs so command names, cost tiers, Redis skip/required behavior, and coverage guidance match the implemented gates.
```

QE-01C (QE-1) — self-healing artifact-root isolation:

```text
Execute AUR-QE-105. Add typed per-test artifact-root helpers for Playwright and Vitest, stop deleting shared self-healing output paths, scope evidence lookup to the current test root/run/test id, and prove guarded self-healing can run without cross-test artifact races.
```

QE-01D (QE-1/2) — semantic contract assertions baseline:

```text
AUR-QE-107 is complete. Keep future contract changes semantic-first: raw toContain/toMatch and bare boolean toBe(true)/toBe(false) stay banned in contract specs, workflow/JSON/Compose checks should use parsed models where practical, and any remaining public compatibility or safety wording checks must include an explicit rationale through tests/helpers/contractAssertions.ts.
```

QE-02A (QE-2) — security and CLI effect boundaries:

```text
Execute AUR-QE-108 and AUR-QE-115. Split security audit/workflow ownership, add representative effect-level security failure proof without weakening SHA-pinned workflow contracts, and add fast process-boundary tests for workflow-invoked scripts that assert exit code plus actionable stdout/stderr for success and expected-failure cases.
```

QE-02B (QE-2) — risk-weighted coverage and assertion-strength baseline:

```text
Execute AUR-QE-109 and AUR-QE-110. Add focused unit coverage and thresholds for the listed high-risk modules before raising floors, keep global coverage as an erosion guard, and establish a bounded mutation/property baseline for scoring/config/guarded validation/retry/Redis CAS. Do not add a new test dependency without explicit approval; use the smallest deterministic scheduled/manual baseline until runtime and tooling are accepted.
```

QE-02C (QE-2) — context-isolated self-healing tests:

```text
Execute AUR-QE-111. Requires AUR-IMPL-021 complete. Use AuroraFlowContext or the equivalent approved runtime-context seam to inject self-healing config, registry runtime, privacy policy, telemetry, and artifact root; remove process.env writes from self-healing specs; add a two-context isolation test; and preserve public constructor compatibility.
```

QE-02D (QE-2) — iframe guarded recovery through structured candidates:

```text
Execute AUR-QE-112. Requires AUR-IMPL-020 complete. Add frame-aware structured candidate coverage, keep the legacy string artifact read path, remove guarded-validation dependence on parsing locator strings, and unfix the iframe guarded E2E only through the structured-candidate path. If the architecture dependency is absent, stop instead of patching the legacy parser.
```

QE-02E (QE-2) — lifecycle and Playwright fixture cleanup proof:

```text
Execute AUR-QE-113. Requires AUR-IMPL-021 and AUR-IMPL-023 complete. Prove closeAuroraFlow(context?) and auroraflow/playwright cleanup semantics with unit and fixture tests for idempotent/concurrent close, reverse disposer order, aggregate errors, disabled-subsystem no-ops, and consumer-owned Playwright Page/BrowserContext boundaries.
```

QE-02F (QE-2) — flake governance and PR risk E2E lane:

```text
Execute AUR-QE-114. Add warn-first flake triage policy with owner fields, make full or partial E2E runnable for risky PRs through the accepted label/path/manual trigger, keep default PR feedback fast, and ensure quarantined or repeated flakes remain visible in actionable reports.
```

QE-03A (QE-3) — versioned artifact compatibility fixtures:

```text
Execute AUR-QE-116. Requires AUR-IMPL-029 complete for full schema versioning/repair. Add versioned artifact fixtures, document compatibility policy, and test must-read, skip-with-warning, and hard-reject behavior so report/schema consumers are protected from artifact drift.
```

QE-03B (QE-3) — typed observability validators:

```text
Execute AUR-QE-117. Prefer landing after or alongside AUR-IMPL-031. Move observability smoke checks from workflow grep strings into typed Node validators with JSON diagnostics, keep workflows as orchestration only, and reduce contracts to validator invocation plus durable configuration invariants.
```

QE-03C (QE-3) — failure-path performance baseline:

```text
Execute AUR-QE-118. Requires AUR-IMPL-032 complete. Build the deterministic failure fixture, measure safe-action failure path, DOM snapshot, SAT candidate extraction, and artifact write cost, record a reproducible baseline, and keep performance output warning-only until the maintainer accepts a hard budget.
```

QE-04A (QE-4) — release-governance closeout audit:

```text
After all task prompts above are complete, audit Sections 9 and 10 of docs/QUALITY_ENGINEERING_IMPLEMENTATION_PLAN.md against the implemented scripts, workflows, docs, and evidence artifacts. Do not add new scope; reconcile any stale gate names or open-decision defaults, run the required and release dry-run gates that exist, and record any remaining release-readiness blockers explicitly.
```
