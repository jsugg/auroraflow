# Phase 0 Validation Baseline

This baseline records repeatable validation expectations for Phase 0 implementation tasks. It satisfies `AUR-IMPL-008` and applies to `AUR-IMPL-001` through `AUR-IMPL-008`.

## Scope

Phase 0 changes cover decision records, self-healing policy, candidate regression tests, scoring/SLO governance, history atomicity, TTL alignment, config diagnostics, and validation inventory. Runtime-code tasks must run their targeted command plus the relevant full command set below. Docs-only tasks run docs validation only unless maintainers ask for broader gates.

## Docs-only validation

Use this gate for `AUR-IMPL-001`, `AUR-IMPL-008`, and other docs/governance-only changes.

```bash
npm run format:check
npm run test:integration -- --run tests/suites/contracts/docs/documentationSurface.contract.spec.ts
```

If the npm/Vitest path filter is unsupported, run the direct contract fallback and record the reason:

```bash
npx vitest run tests/suites/contracts/docs/documentationSurface.contract.spec.ts
```

## Targeted Phase 0 commands

| Task ID | Purpose | Targeted command | Expected evidence |
| --- | --- | --- | --- |
| `AUR-IMPL-001` | Decision log discoverability | `npm run format:check && npm run test:integration -- --run tests/suites/contracts/docs/documentationSurface.contract.spec.ts` | Decision log contains `AUR-DEC-001` through `AUR-DEC-013`, owner, evidence, default, fallback, phase gate, affected tasks, and proceed/defer/non-goal authority. |
| `AUR-IMPL-002` | Guarded-healing reachability | `npm run test:unit -- --run tests/suites/unit/framework/selfHealing/candidateScoring.spec.ts tests/suites/unit/framework/selfHealing/guardedValidation.spec.ts` | Candidate classes pass/fail according to default guarded policy. |
| `AUR-IMPL-003` | Locator quote and candidate regression | `npm run test:unit -- --run tests/suites/unit/framework/selfHealing/guardedValidation.spec.ts tests/suites/unit/framework/selfHealing/domCandidateExtraction.spec.ts` | Apostrophe, double-quote, role/name, label, text, and CSS cases are covered or explicitly marked as legacy limitations. |
| `AUR-IMPL-004` | Scoring/SLO drift governance | `npm run test:unit -- --run tests/suites/unit/framework/selfHealing/candidateScoring.spec.ts tests/suites/unit/framework/observability/sloDashboard.spec.ts`; `npm run test:integration -- --run tests/suites/contracts/workflows/slo-dashboard-alerting.contract.spec.ts` | Drift between scoring, dashboard, policy, and rules is either prevented or documented as intentional. |
| `AUR-IMPL-005` | Candidate-history atomicity | `npm run test:integration -- --run tests/suites/integration/framework/data/redisIntegration.spec.ts` | Concurrent observations preserve exact counts for the selected store path. |
| `AUR-IMPL-006` | Candidate-history TTL contract | `npm run test:unit -- --run tests/suites/unit/framework/selfHealing/registryPersistence.spec.ts tests/suites/unit/framework/selfHealing/suggestionEngine.spec.ts && npm run schemas:check` | Exported default, clamp, schema, and docs agree on TTL behavior. |
| `AUR-IMPL-007` | Self-healing config diagnostics | `npm run test:unit -- --run tests/suites/unit/framework/selfHealing/config.spec.ts` | Invalid environment values warn or throw according to strictness; effective config is visible. |
| `AUR-IMPL-008` | Baseline inventory | `npm run format:check && npm run test:integration -- --run tests/suites/contracts/docs/documentationSurface.contract.spec.ts` | This baseline lists targeted commands, full commands, Redis/Docker fallback, and journal evidence format. |

## Full Phase 0 command set

Run these after runtime or test changes unless the task card narrows scope and the implementation journal records why a command was skipped.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run schemas:check
```

## Redis and Docker fallback

`AUR-IMPL-005` and any Redis-backed history validation should prefer the integration command. If Docker, Testcontainers, or Redis is unavailable:

1. Record the exact failing command and exit code.
2. Record environment evidence, such as missing Docker daemon, blocked socket, or unavailable image pull.
3. Run the closest unit or memory-store command that does not require Redis.
4. Mark Redis coverage as skipped in the implementation journal and keep the PR blocked for merge unless a maintainer accepts the fallback.

Do not replace Redis atomicity with process-local locks as final evidence.

## Journal evidence format

Every Phase 0 handoff entry should include:

- task ID and validation ID;
- files changed;
- command, exit code, and short result;
- skipped command and reason, if any;
- fallback command and result, if used;
- evidence artifact, such as docs touched, fixture list, count table, or schema values;
- unresolved risks and next task.
