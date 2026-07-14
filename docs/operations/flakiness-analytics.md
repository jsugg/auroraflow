# Flakiness Analytics

AuroraFlow can aggregate Playwright matrix outputs into a deterministic flakiness summary.

## Local Command

Generate a flakiness report from Playwright JSON outputs:

```bash
npm run flakiness:report -- --input-dir test-results
```

Optional flags:

- `--output-json <path>`: default `test-results/flakiness-summary.json`
- `--output-md <path>`: default `test-results/flakiness-summary.md`
- `--top-limit <n>`: number of top flaky cases in markdown table (default `10`)
- `--triage-policy <path>`: warn-first triage policy JSON (owners, quarantine, repeat threshold)
- `--triage-output-md <path>`: triage markdown (default `flakiness-triage.md` beside `--output-md`)
- `--trend-output <path>`: append a bounded JSONL trend point
- `--trend-limit <n>`: max retained trend points (default `100`)

Input discovery behavior:

- The command recursively scans `--input-dir`.
- It reads files named `playwright-results-*.json`.
- Missing input files produce a `no-input` summary status instead of failing the command.

Trend output can also be enabled with:

- `AURORAFLOW_TREND_OUTPUT`
- `AURORAFLOW_TREND_LIMIT`

Trend points include run metadata (`runId`, branch, commit, workflow, project), pass/fail/flake/retry totals and rates, plus empty self-healing/governance fields when only flakiness data is available.

## CI Integration

In `.github/workflows/ci.yml`:

- each E2E matrix shard writes `test-results/playwright-results-<project>-shard-<n>.json`.
- `Flakiness Report` downloads matrix artifacts after E2E execution.
- report outputs are uploaded as `flakiness-report` artifacts:
  - `flakiness-summary.json`
  - `flakiness-summary.md`
  - `flakiness-triage.md`
  - `flakiness-trends.jsonl`
- `.auroraflow-trends/flakiness-trends.jsonl` is restored through a branch-scoped cache and uploaded for triage.
- Trend reads skip malformed non-empty JSONL lines by default, preserve valid points, and report `skippedMalformedLines`; callers can opt into strict parsing through the library API.
- CI caches are evictable, branch-scoped history—not a durable analytics store.

Longer-lived history uses the optional [operator-owned durable export handoff](./trend-durable-export.md). AuroraFlow does not configure or upload to a destination.

Use this artifact to identify:

- flaky cases (`failed attempt(s)` followed by `passed` final status),
- hard failures,
- retry pressure by project and test.

## Flake triage governance

`flakiness:report` also emits a warn-first triage report (`flakiness-triage.md`) driven by `configs/flakiness-triage-policy.json`. The policy is **warn-first**: it never blocks the merge gate; it converts flaky/failing signal into ownership and action.

Policy fields:

- `defaultOwner`: owner used when no path rule matches.
- `owners`: `{ "pathPrefix", "owner" }` rules; the longest matching test-file path prefix wins.
- `quarantined`: case identifiers (`caseId` or `fullTitle`) excluded from gating but kept visible.
- `repeatedFailureThreshold`: failed attempts at which a flaky case is flagged as a repeated flake (default `2`).

The triage report groups, per owner, the failing tests, flaky tests, quarantined tests (kept visible even when the run passed), and repeated flakes (failed attempts at or over the threshold), each with an actionable next step. Quarantined and repeated flakes always appear in the report so they cannot silently disappear.

### PR E2E lane

Default pull requests stay fast: the single path-filtered `E2E (Chrome)` job in `quality.yml` runs the full Chrome project only on browser-relevant changes and is skipped (no runner) otherwise. Because the full Chrome suite is the union of the former smoke, guarded self-heal, examples, and risk subsets, no Playwright test ID runs twice on a pull request. It also runs on `main`, on scheduled/manual dispatch, and can be forced on an otherwise-skipped PR with the `risk:e2e` or `full-e2e` label. Exhaustive cross-browser coverage runs on the daily `E2E Matrix`.

## Downstream SLO and Alerting

The flakiness summary is also the upstream data source for:

- `npm run slo:dashboard` (SLO KPI dashboard),
- `npm run slo:alerts` (threshold-based alert policy evaluation).

See `docs/operations/slo-dashboard-alerting.md` for command and CI wiring details.
