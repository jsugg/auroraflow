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

## Guarded Safety Policy

- `SELF_HEAL_ALLOWED_ACTIONS` controls which action types may run guarded validation.
- Default actions: `click,type,read,wait,screenshot`.
- `navigate`, `close`, and `unknown` are blocked unless explicitly allowed.
- `SELF_HEAL_ALLOWED_DOMAINS` controls host allow-list for guarded validation.
- When domain allow-list is empty, domain checks are not enforced.
- When domain allow-list is set, guarded validation is blocked for missing/invalid URLs and non-allowed hosts.

## Failure Artifact Output

When mode is `suggest` or `guarded`, failed actions emit structured JSON artifacts to:

`test-results/self-healing/*.json`

Each artifact includes:

- `eventId`, `timestamp`, and schema version.
- mode and confidence threshold used at runtime.
- safety policy used at runtime (`allowedActions`, `allowedDomains`).
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
- Policy checks run before candidate validation and can block evaluation for disallowed actions/domains.

Guarded validation results are stored in `guardedValidation` with per-candidate status and accepted
candidate metadata when available, plus policy decision details (`actionAllowed`, `domainAllowed`,
`blockedReason`, `evaluatedDomain`).

### Guarded Auto-Apply (Single Retry)

When guarded validation produces an accepted candidate and the action is supported, AuroraFlow attempts
one auto-apply retry before surfacing the original failure:

- Supported action retries: `click`, `type`, `read`, and `wait`.
- Auto-apply is attempted only for confidence-eligible, policy-allowed candidates.
- Auto-apply never suppresses a failed retry; the original action failure still propagates.
- Auto-apply outcomes are captured under `guardedAutoHeal`:
  - `attempted`, `succeeded`
  - `locator` (accepted locator expression)
  - `skippedReason` when no attempt is made
  - `errorMessage` when retry fails

## CI Governance and Triage

AuroraFlow includes a governance pass for self-healing artifacts in CI:

- Command: `npm run self-heal:governance`
- Default artifact source: `test-results/self-healing`
- Governance outputs:
  - JSON summary: `test-results/self-healing-governance-summary.json`
  - Markdown summary: `test-results/self-healing-governance-summary.md`

### Acknowledgement Gate

- `SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED` controls whether guarded accepted candidates require explicit acknowledgement (default `true`).
- `SELF_HEAL_ACKNOWLEDGED=true` acknowledges reviewed guarded accepted candidates and allows the governance step to pass.
- If guarded accepted candidates exist and acknowledgement is missing, governance fails with a blocking signal.

### Optional Auto-Triage Issue

- CI can open a triage issue automatically when guarded accepted candidates are detected.
- Enable with repository variable `SELF_HEAL_AUTO_OPEN_TRIAGE_ISSUE=true`.
- Auto-triage runs on `main` only and uses the governance markdown summary as issue body.
