# Mutation & property baseline

This is the scoped assertion-quality baseline for calibration-critical code. It measures whether tests actually _catch_ defects, not just whether lines execute.

## Approach and dependency policy

This baseline starts with the **smallest deterministic footprint and no new test dependency** (no Stryker, no fast-check) until runtime and tooling are accepted for PR gating:

- **Property tests** use an in-repo seeded generator, `tests/helpers/propertyTesting.ts` (mulberry32 PRNG + `forAll`). They run inside the normal `npm run test:unit` suite. Failures are reproducible from the seed: every failure reports `seed`, `run`, and the offending `case`.
- **Mutation tests** use an in-repo runner, `scripts/mutation-baseline.mjs`, that applies a curated set of source mutations in place, runs the scoped specs, and records killed/survived/inapplicable outcomes. It runs **manually or on a schedule**, not in `verify`.

If/when a heavier tool (Stryker/fast-check) is approved, these baselines define the behavior that tool must preserve.

## Scope

Scoring, config, guarded validation, retry, and Redis compare-and-set:

| Area | Source | Property spec | Mutation tests |
| --- | --- | --- | --- |
| Scoring/ranking | `src/framework/selfHealing/candidateScoring.ts` | `candidateScoring.property.spec.ts` | ordering, bounded limit |
| Config parsing | `src/framework/selfHealing/config.ts` | `config.property.spec.ts` | confidence bound, integer bounds, clamp |
| Guarded validation | `src/framework/selfHealing/guardedValidation.ts` | `guardedValidation.property.spec.ts` | confidence gate `>=` |
| Retry/backoff | `src/helpers/helpers.ts` | `retry.property.spec.ts` | terminal-attempt off-by-one, integer bound |
| Redis CAS | `src/utils/redisClient.ts` | `redisClient.property.spec.ts` | reply-shape guard, written flag, expected-version bound |

## Running

```bash
npm run test:unit            # property tests run here (fast, seeded, bounded)
npm run test:mutation        # refresh + record the mutation baseline (warning-only, exit 0)
npm run test:mutation:check  # fails if a killed mutant now survives or becomes inapplicable
```

The Quality Gates workflow runs this check as `Mutation Baseline (Advisory)` on scheduled and manual evidence runs, then uploads `baseline-check.txt` even on failure. It is intentionally not part of `npm run verify` or branch protection because it mutates source files in place (each is restored in a `finally`, plus a top-level safety restore) and is slower than the fast gate.

## Current baseline

Recorded in `docs/quality/mutation-baseline.json`: **11/11 mutants killed (kill rate 1.0), 0 inapplicable**, across all five scoped areas.

## Triage policy

- A surviving mutant means an assertion gap. It must be **triaged into a test or recorded as a documented exception** — never silently ignored.
- The runner marks a mutation `inapplicable` when its `find` string no longer matches exactly once (source drift). A previously killed mutant becoming inapplicable is a regression: update the manifest in the same change as the source edit, then deliberately review and record the replacement baseline.
- Expanding the manifest: add an entry to `MUTATIONS` in `scripts/mutation-baseline.mjs` and re-run `npm run test:mutation`. New survivors are expected as coverage of operators grows; resolve each before promoting the gate from warning-only to required.
