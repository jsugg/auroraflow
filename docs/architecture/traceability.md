# Architecture and Quality Engineering Registry

This registry is a self-contained record of completed architectural improvements and quality-engineering decisions. It is not a work journal; use ADRs, the decision log, PR descriptions, and task-owned docs for current evidence.

## Architecture snapshot

AuroraFlow is a public-target npm library (pre-publish; see the [release process](../operations/release-process.md#current-state-dry-run-only) for the canonical release state) that runs inside consumer Playwright Node processes. The runtime remains library-first rather than service-owned: consumers own test execution, CI, Redis, observability backends, retention, credentials, and incident response. The package owns safe page-object helpers, Selector Analysis Tooling (SAT), optional selector-registry adapters, failure artifacts, local reports, and reference observability assets.

Target architecture is conservative evolution with internal seams:

- keep one `auroraflow` package until adoption evidence and an owner justify a split;
- keep self-healing safety-first: default off, guarded/dry-run validation, one retry, no blind selector mutation, no source rewrite, and reviewed registry promotions only;
- keep Redis optional and operator-owned; prefixes are namespace hygiene, not authorization;
- keep artifact-first observability as the supported default, observability-lite best effort, and the full stack local/reference only;
- prefer typed seams such as `AuroraFlowContext`, `SelectorStore`, telemetry ports, lifecycle disposers, and structured `CandidateLocator` records over process-global state or string parsing;
- keep failure-path budgets and SLO/flake breaches warning-only until measured evidence and a named owner approve hard gates.

## Quality-engineering snapshot

Quality gates use a four-band model:

- unit tests are the fast default and `npm test` target;
- contract tests guard docs, workflows, package surface, schemas, and repo invariants without Redis/OTLP side effects;
- integration tests own Redis/Testcontainers and OTLP process-boundary proof;
- browser E2E remains targeted, risk-triggered, scheduled, or manual for expensive proof.

Semantic contracts are preferred over raw text matching. Contract specs may keep rare wording checks only through rationale helpers. Required CI verification (the Static Analysis lane, plus unit tests on the Node compatibility matrix) includes unit, contracts, integration, schema validation, formatting, linting, typecheck, ShellCheck, and workflow lint; schema validation is a separate CI/release evidence gate rather than part of `npm run verify`. Coverage uses global erosion guards plus risk-weighted per-file floors for critical paths.

## Completed architectural improvements

### Governance and decisions

A stakeholder decision log was created to record durable decisions. Contributor onboarding guidance, CODEOWNERS, and ADRs were added. Adoption-readiness and backend-extensibility decision criteria were established.

### Self-healing safety

The self-healing system was redesigned with safety-first defaults: a guarded-healing bootstrap policy, structured locator candidates replacing stringly-typed parsing, and centralized governance of scoring, threshold, and SLO constants. Candidate history updates were made atomic and TTL defaults were aligned with actual clamps. Self-healing config diagnostics were added to surface effective configuration. A run-level self-healing budget and failure-storm breaker were introduced.

### API stability and release governance

API stability tiers and a deprecation policy were defined. A dry-run release workflow was implemented with SBOM generation (SPDX + CycloneDX), npm trusted-publishing/provenance readiness checks, and changelog drafting; npm provenance is produced only at a future real publish, and artifact signing remains deferred (`AUR-DEC-012`).

### Privacy and retention

Privacy and retention documentation was added. Screenshot and DOM-text privacy controls were designed into the artifact pipeline.

### Runtime and lifecycle

`AuroraFlowContext` runtime injection was added to replace process-global env and singleton runtime models. A package-level lifecycle helper and Playwright fixture were implemented. An internal page-action pipeline was introduced behind `PageObjectBase`. Logger initialization was made lazy to eliminate import-time side effects.

### Testing and coverage

A Playwright peer-version matrix was added to CI. Coverage thresholds with risk-weighted per-file floors were established for critical paths. Scoped mutation and property/concurrency testing baselines were added.

### Selector store

A productized memory selector store and a store conformance suite were implemented.

### Trend and observability

Trend export was hardened with malformed-line resilience and a durable export option. Observability-lite support boundaries were defined. Focused OTLP integration coverage was added near the code path.

### Registry and promotion

Promotion authorization was moved from identity strings to policy. Expected-status concurrency semantics were added to promotion record updates. Audit retention cleanup was implemented. Redis production runbook and selector-store strategy were documented. Selector-registry schema versioning and repair tooling were hardened.

### Performance

A failure-path benchmark and DOM snapshot latency metrics were added.

### API ergonomics

Locator-first Playwright API ergonomics were designed and reviewed before prototypes.

### CI and packaging

GitHub Actions remains the only first-class CI orchestration target, with a trigger point defined for non-GitHub CI support. Package split and a companion observability repository are deferred until adoption and support-owner evidence exists. Hosted SAT is recorded as a deferred non-goal.

## Completed quality-engineering improvements

### Test taxonomy and isolation

The default `npm test` target was corrected to run only fast tests (unit and contract), with browser E2E remaining targeted, risk-triggered, scheduled, or manual. Stale suite globs and unsafe pass-with-no-tests behavior were removed. Self-healing artifact directories were isolated per test. Self-healing tests were decoupled from global `process.env` mutation.

### Schema and contract validation

Schema validation was added to the required CI verification gates (the Static Analysis lane), as a standalone evidence step outside `npm run verify`. Brittle contract text assertions in Markdown, YAML, and workflows were replaced with semantic checks using parsed models. Observability workflow validation was converted from shell grep to typed validators.

### CI topology

The CI matrix was split so Docker/browser-heavy and integration gates run separately from fast unit and contract gates. Expensive work was deduplicated across the Node matrix.

### Security

Effect-level security checks were added. Security workflow duplication was cleaned up.

### Coverage and testing depth

Risk-weighted coverage floors were added for critical paths. Scoped mutation and property testing baselines were introduced. Versioned artifact compatibility fixtures were added.

### Self-healing correctness

Iframe guarded recovery was unhidden from `test.fixme` and implemented through structured candidates. Lifecycle fixture cleanup tests were added.

### Flake governance

Flaky-test governance was moved from reporting-only to active gating, with a PR risk E2E lane added.

### CLI boundaries

CLI boundary tests were added for CI scripts, with timing stabilization.

### Documentation

Developer and testing documentation was updated to reflect the current repository state.

### Performance

Failure-path and DOM snapshot performance baselines were added.

## Constraints and deferred decisions

The following constraints and deferred decisions govern current and future work:

- No full rewrite of the existing system.
- No package split until adoption evidence and an owner justify it.
- No hosted SAT implementation is authorized.
- No mandatory full observability stack; artifact-first observability remains the supported default.
