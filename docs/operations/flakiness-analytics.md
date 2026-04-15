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

Input discovery behavior:

- The command recursively scans `--input-dir`.
- It reads files named `playwright-results-*.json`.
- Missing input files produce a `no-input` summary status instead of failing the command.

## CI Integration

In `.github/workflows/ci.yml`:

- each E2E matrix shard writes `test-results/playwright-results-<project>-shard-<n>.json`.
- `Flakiness Report` downloads matrix artifacts after E2E execution.
- report outputs are uploaded as `flakiness-report` artifacts:
  - `flakiness-summary.json`
  - `flakiness-summary.md`

Use this artifact to identify:

- flaky cases (`failed attempt(s)` followed by `passed` final status),
- hard failures,
- retry pressure by project and test.

## Downstream SLO and Alerting

The flakiness summary is also the upstream data source for:

- `npm run slo:dashboard` (SLO KPI dashboard),
- `npm run slo:alerts` (threshold-based alert policy evaluation).

See `docs/operations/slo-dashboard-alerting.md` for command and CI wiring details.
