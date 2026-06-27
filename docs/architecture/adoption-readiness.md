# Adoption Readiness and Extensibility Gates

Status: accepted governance record. Date: 2026-06-27.

This report records the adoption-readiness assessment, backend extensibility criteria, memory-store tier decision, and non-GitHub CI trigger record. It is governance-only: it authorizes no new stores, no CI templates, no package split, and no architecture expansion.

## Executive recommendation

Continue with the existing public-library foundation:

- keep one `auroraflow` npm package;
- keep Redis as the only durable selector-store backend;
- keep `MemorySelectorStore` as a supported non-durable tier for tests, fixtures, and local experiments;
- keep GitHub Actions as the only first-class CI surface;
- keep observability artifact-first, Lite best effort, and Full local/reference only;
- defer package split, additional stores, non-GitHub CI templates, and broader architecture expansion until evidence gates pass.

Evidence-gate result: not approved for expansion.

## Evidence snapshot

| Evidence area | 2026-06-27 observation | Readiness signal |
| --- | --- | --- |
| Package publication | `npm view auroraflow name version time.modified repository.url --json` returned `E404`; the package name was not present in the public npm registry. | No external npm adoption signal. |
| Download demand | `https://api.npmjs.org/downloads/point/last-month/auroraflow` returned 404. | No download trend signal. |
| User requests | `gh issue list --repo jsugg/auroraflow --state all --limit 100 --json ...` returned an empty list. | No recorded GitHub issue demand for stores, package split, or non-GitHub CI. |
| Internal foundation | Completed foundation work includes API stability, release dry-run, privacy controls, lifecycle helper, runtime context, self-healing budget, promotion governance, Redis runbook, schema repair, optional trend export, observability support tiers, failure benchmark, and lazy logger. | Strong internal foundation, but still adoption evidence, not expansion evidence. |
| Support capacity | CODEOWNERS remains advisory, owned by the current maintainer route until confirmed or replaced. | No evidence of multi-owner capacity for extra platforms. |

## Adoption-readiness assessment

| Dimension | Current assessment | Decision |
| --- | --- | --- |
| Target market | Public TypeScript Playwright library for teams that want page-object primitives, guarded self-healing diagnostics, optional Redis selector registry, and CI artifacts. | Keep public-library rigor; do not claim platform/SaaS maturity. |
| Scale | Local and small-team use is credible. Shared durable selector registries require consumer/operator-owned Redis with reviewed promotion controls. | Defer multi-tenant/shared-service architecture. |
| Install and dependency weight | Redis and OpenTelemetry dependencies are present, but no npm adoption or install-size complaint evidence exists. | Monitor; do not split packages before evidence and owner exist. |
| Support needs | Current support surface is Node `>=20 <25`, Playwright `>=1.59 <2`, GitHub Actions examples, optional Redis, and optional observability. | Do not add support surfaces without named owner capacity. |
| Sensitive data | Supported privacy posture is synthetic and non-prod PII only; regulated or prod-like data remains out of scope. | Do not broaden compliance claims. |
| Maintainer capacity | No issue demand or additional owner evidence was found. | Prefer documentation precision and contract tests over expansion. |

## Backend extensibility criteria

New selector stores or durable backend adapters are rejected by default. Approval requires all gates below.

| Gate | Required evidence before implementation | Current result |
| --- | --- | --- |
| Demand | At least two independent actionable user requests for the same backend, or one maintainer-approved adopter with reproducible constraints that Redis cannot satisfy. | Not met. |
| Owner | Named maintainer/domain owner for implementation, security review, docs, release notes, and ongoing issue triage. | Not met. |
| Contract parity | Full `SelectorStore` conformance: `get`, `getMany`, `set`, `del`, `keys`, `scanKeys`, TTL, compare-and-set, JSON-field compare-and-set where required, and atomic JSON merge. | Required for future work. |
| Durability semantics | Clear tier label: non-durable, durable single-process, durable shared, or reference-only. Claims must match actual failure behavior. | Redis durable; memory non-durable. |
| Concurrency and consistency | Lost-update prevention, expected-version conflict behavior, bounded scans, and atomic candidate-history increments must be proven against the real backend. | Required for future work. |
| Security and operations | TLS/auth/ACL/network guidance, prefix/namespace limits, backup/restore, retention, capacity, compatibility, incident, and cleanup/repair guidance. | Required for future durable stores. |
| Compatibility | Schema versioning, legacy read behavior, repair/migration path, rollback plan, and package-surface classification. | Required for future work. |
| Validation | Unit tests, shared conformance suite, real-backend integration where possible, docs contracts, schema checks, typecheck, lint, and build. | Required for future work. |
| Release plan | Semver impact, dependency impact, optionality, docs, and support boundary must be reviewed before export. | Required for future work. |

Evidence-gate authority: no new backend adapter may start until this table has a named owner and a recorded pass result in the decision log or a successor ADR.

## Memory-store tier decision

Decision: `MemorySelectorStore` remains a supported non-durable selector-store tier. It is appropriate for unit tests, fixture-scoped state, process-boundary CLI tests, and local experiments. It is not a durable CI, team, or shared-registry backend.

Rationale:

- implementation advertises `durability: 'non-durable'`;
- data is process-local and lost on close or process exit;
- state is not shared across workers, machines, or CI jobs;
- it passes the shared `SelectorStore` conformance suite for the non-durable tier;
- it supports TTL, deterministic clock injection, `getMany`, `scanKeys`, compare-and-set, JSON-field compare-and-set, atomic JSON merge, `clear()`, and idempotent `close()`;
- it cannot provide backup, restore, ACL, network isolation, or cross-process consistency because those are outside its design.

Adoption path:

1. Keep examples and tests using memory storage only where non-durable state is explicit.
2. Use Redis for durable or shared selector registries.
3. Record user requests that ask for local no-Redis workflows separately from requests for durable storage.
4. Do not graduate memory storage to a durable tier; create a separate backend proposal if users need durability without Redis.

## Non-GitHub CI trigger record

Decision: GitHub Actions remains the only first-class CI target. No GitLab CI, Azure DevOps, Jenkins, CircleCI, Buildkite, or other CI template is approved by this record.

Low-cost translation notes may be considered only if:

- at least one actionable user request identifies the CI provider and missing mapping;
- the change is documentation-only and does not add a maintained template;
- the note preserves AuroraFlow's existing security expectations, including pinned actions/equivalents, least privilege, artifact retention, and secret boundaries.

First-class non-GitHub CI templates require all of:

- at least three independent requests for the same CI provider, or one maintainer-approved adopter with committed feedback and reproducible workflow logs;
- named DevEx owner for maintenance and security review;
- local or CI validation for the new template syntax;
- equivalent dependency, secret scanning, artifact retention, and required-gate semantics;
- clear docs stating support level, runner assumptions, secrets, caches, and rollback.

Current trigger status: not met. Existing GitHub workflow examples under `examples/ci/` remain the supported template path.

## Evidence collection backlog

Track these signals before revisiting the decision:

- npm publish and download data after a real release;
- GitHub issues, discussions, or support requests tagged by backend, CI provider, package split, or install-size concern;
- CI duration and support cost for maintaining existing GitHub lanes;
- user reports that Redis is unacceptable despite the memory non-durable tier;
- contributor or maintainer commitments for new support surfaces.
