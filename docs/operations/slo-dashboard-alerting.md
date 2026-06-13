# SLO Dashboard and Alert Policies

AuroraFlow can derive KPI-oriented SLO metrics from flakiness telemetry and evaluate threshold-based alert policies.

## Inputs

- Flakiness summary JSON (`flakiness-summary.json`) produced by:
  - `npm run flakiness:report`
- Optional self-healing governance summary JSON
  - `test-results/self-healing-governance-summary.json`

## Generate SLO Dashboard

```bash
npm run slo:dashboard -- \
  --flakiness-json test-results/flakiness-summary.json \
  --output-json test-results/slo-dashboard.json \
  --output-md test-results/slo-dashboard.md \
  --trend-output test-results/slo-trends.jsonl
```

Optional governance enrichment:

```bash
npm run slo:dashboard -- \
  --flakiness-json test-results/flakiness-summary.json \
  --governance-json test-results/self-healing-governance-summary.json
```

## Evaluate Alert Policies

```bash
npm run slo:alerts -- \
  --dashboard-json test-results/slo-dashboard.json \
  --policy-file configs/quality/slo-alert-policy.json \
  --output-json test-results/slo-alerts.json \
  --output-md test-results/slo-alerts.md \
  --trend-output test-results/slo-trends.jsonl
```

Behavior:

- Breaches emit warning annotations in CI logs by default.
- Repository policy rules use warning severity and `blockOnBreach: false`; changing either requires an updated QA/SRE decision.
- Blocking rules (`blockOnBreach: true`) fail the command when an explicit policy opts in.
- `--fail-on-breach` fails on any breach regardless of `blockOnBreach`.
- `--trend-output` appends SLO dashboard and alert-evaluation trend points to bounded JSONL.
- `--trend-limit <n>` controls retained trend points (default `100`); environment fallbacks are `AURORAFLOW_TREND_OUTPUT` and `AURORAFLOW_TREND_LIMIT`.

Dashboard targets, `configs/quality/slo-alert-policy.json`, and local Prometheus SLO rules are covered by a drift contract test so warn-by-default thresholds stay aligned.

## CI Integration

In `.github/workflows/ci.yml`:

- `Flakiness Report` aggregates matrix reports.
- `SLO Dashboard and Alerts` consumes the flakiness artifact, generates:
  - `slo-dashboard.json`
  - `slo-dashboard.md`
  - `slo-alerts.json`
  - `slo-alerts.md`
  - `slo-trends.jsonl`
- `.auroraflow-trends/slo-trends.jsonl` is restored through a branch-scoped cache and uploaded as part of `slo-dashboard-alerts`.
- Trend reads skip malformed non-empty JSONL lines by default, preserve valid points, and report `skippedMalformedLines`; callers can opt into strict parsing through the library API.
- CI caches are evictable, branch-scoped history—not a durable analytics store.

Optional strict gate:

- Set repository variable `SLO_ALERT_FAIL_ON_BREACH=true` to fail CI on any breach.
