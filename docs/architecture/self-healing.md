# Self-Healing Foundation

AuroraFlow supports a mode-gated self-healing failure-capture foundation for failed page actions.

## Modes

- `SELF_HEAL_MODE=off`: disable self-healing capture (default).
- `SELF_HEAL_MODE=suggest`: capture failure artifacts for triage and suggestion workflows.
- `SELF_HEAL_MODE=guarded`: capture failure artifacts for guarded auto-heal workflows.

## Confidence Threshold

- `SELF_HEAL_MIN_CONFIDENCE` controls the confidence floor used by downstream self-healing decisions.
- Accepted range is `0` to `1`.
- Invalid or missing values default to `0.92`.

## Failure Artifact Output

When mode is `suggest` or `guarded`, failed actions emit structured JSON artifacts to:

`test-results/self-healing/*.json`

Each artifact includes:

- `eventId`, `timestamp`, and schema version.
- mode and confidence threshold used at runtime.
- page object context and current URL (when available).
- action metadata (type, target, description).
- normalized error details.
- screenshot path captured for the failure.
- ranked locator suggestions with weighted scoring signals
  (`roleSignal`, `accessibleNameSignal`, `uniquenessSignal`, `historicalSignal`, `similaritySignal`).

### Guarded Mode Dry-Run Validation

When mode is `guarded`, AuroraFlow evaluates ranked locator suggestions in dry-run mode before writing
the failure artifact:

- Candidates below `SELF_HEAL_MIN_CONFIDENCE` are marked as skipped.
- Supported locator expressions are resolved against the current page and checked for matches and visibility.
- The first confidence-eligible visible candidate is marked as `accepted` for operator review.
- No action is auto-applied in this stage; validation is diagnostic and auditable only.

Guarded validation results are stored in `guardedValidation` with per-candidate status and accepted
candidate metadata when available.
