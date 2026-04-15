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
  --output-md test-results/slo-dashboard.md
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
  --output-md test-results/slo-alerts.md
```

Behavior:

- Breaches emit warning annotations in CI logs.
- Blocking rules (`blockOnBreach: true`) fail the command.
- `--fail-on-breach` fails on any breach regardless of `blockOnBreach`.

## CI Integration

In `.github/workflows/ci.yml`:

- `Flakiness Report` aggregates matrix reports.
- `SLO Dashboard and Alerts` consumes the flakiness artifact, generates:
  - `slo-dashboard.json`
  - `slo-dashboard.md`
  - `slo-alerts.json`
  - `slo-alerts.md`
- Artifacts are uploaded as `slo-dashboard-alerts`.

Optional strict gate:

- Set repository variable `SLO_ALERT_FAIL_ON_BREACH=true` to fail CI on any breach.
