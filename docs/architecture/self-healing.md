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
- The default `0.92` floor is a safety-first, registry-curated policy: fresh heuristic and DOM candidates are expected to remain below the floor, while curated registry entries and strongly validated candidate history can pass.
- Lowering the default threshold or broadening DOM-pass behavior requires reachability fixtures and a decision-log update.

## SAT Enrichment

Selector Analysis Tooling (SAT) enriches `suggest` and `guarded` artifacts with bounded DOM evidence, optional selector-registry reads, optional candidate history reads, deterministic candidate scoring, and write-pending registry telemetry. SAT can write history observations and pending promotion review records. Reviewed approve, reject, conflict, and rollback workflows operate on selector registry records only; source-code rewrites remain out of scope.

- `SELF_HEAL_SAT_ENABLED` defaults to enabled for `suggest` and `guarded`, disabled for `off`.
- `SELF_HEAL_SAT_CAPTURE_DOM` defaults to true when SAT is enabled.
- `SELF_HEAL_MAX_DOM_NODES` defaults to `500` and is capped at `5000`.
- `SELF_HEAL_MAX_CANDIDATES` defaults to `10` and is capped at `50`.
- `SELF_HEAL_MAX_TEXT_LENGTH` defaults to `120` and is capped at `500`.
- `SELF_HEAL_ALLOWED_ATTRIBUTES` defaults to `data-testid,data-test,id,name,aria-label,placeholder,title,role,type`.
- `SELF_HEAL_REGISTRY_MODE` accepts `off`, `read`, or `write_pending`; `read` loads active selector records/history, while `write_pending` also stores history observations and reviewable pending promotion records after successful guarded auto-apply.
- `SELF_HEAL_REGISTRY_REQUIRED=true` opts into required registry resolution; otherwise read mode is opportunistic when Redis configuration is present.
- `SELF_HEAL_REGISTRY_NAMESPACE` overrides the active selector namespace; default is `selector-registry`.
- `SELF_HEAL_PROMOTION_MODE` accepts `manual` or `ci_acknowledged` for SAT promotion-write posture. Reviewed mutation workflows use the promotion authorization policy: local mode permits with a warning, and shared mode requires CODEOWNERS plus protected-workflow evidence.
- Invalid `SELF_HEAL_*` values produce diagnostics: `resolveSelfHealingConfig()` warns by default and throws `SelfHealingConfigError` when `AURORAFLOW_CONFIG_STRICT=true`; `resolveSelfHealingConfigWithDiagnostics()` exposes the diagnostics and effective config programmatically. Diagnostics never echo received values.

DOM snapshots are captured inside the browser through `page.evaluate` and serialized as compact summaries:

- skipped tags: `script`, `style`, `noscript`, and `template`.
- hidden elements are skipped from candidate extraction.
- attributes are allow-listed and sensitive attribute names containing `password`, `token`, `secret`, `key`, `authorization`, `cookie`, or `session` are redacted.
- input values are not captured by default.
- text is whitespace-normalized and capped by `SELF_HEAL_MAX_TEXT_LENGTH`.

SAT candidate sources include current heuristic suggestions, DOM-backed `getByTestId`, role/name, label, text, bounded CSS fallback candidates, and registry-backed selector candidates. Candidate IDs are deterministic:

`<pageObjectName>::<actionType>::<failedTargetHash>::<strategy>::<locatorHash>`

When action metadata supplies `selectorId`, SAT emits v2 candidate IDs with a stable selector hash:

`v2::<pageObjectName>::<actionType>::<selectorIdHash>::<strategy>::<locatorHash>`

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
- correlation metadata: `runId`, optional `testId`, `component`, and `errorCode`.
- mode and confidence threshold used at runtime.
- safety policy used at runtime (`allowedActions`, `allowedDomains`).
- page object context and current URL (when available).
- action metadata (type, target, description).
- normalized error details.
- optional screenshot path captured for the failure when the privacy policy permits it.
- ranked locator suggestions with weighted scoring signals (`roleSignal`, `accessibleNameSignal`, `uniquenessSignal`, `historicalSignal`, `similaritySignal`).
- optional `sat` payload with snapshot summary, ranked DOM/heuristic candidates, selected candidate ID, history summary, and analysis warnings.
- optional `registryPersistence` payload with history write counts, pending promotion write status, and persistence warnings when `SELF_HEAL_REGISTRY_MODE=write_pending`.

JSON Schema contracts for self-healing artifacts live in [`../operations/artifact-schemas.md`](../operations/artifact-schemas.md).

### Artifact Privacy

`AURORAFLOW_ARTIFACT_PRIVACY_PRESET=compatible` preserves failure screenshot and bounded DOM text capture. The opt-in `sensitive` preset disables failure screenshots and removes visible text, accessible names, and text-bearing attributes before DOM candidate extraction. Custom experimental policies can add screenshot masks or use redact/keyed-hash/disable DOM text modes. See [Artifact privacy and retention](../operations/privacy-retention.md) for residual risks and consumer-owned retention.

### Correlation Identifier Resolution

- `runId` resolution order: explicit correlation input -> `AURORAFLOW_RUN_ID` -> `GITHUB_RUN_ID` -> `local-run`.
- `testId` resolution order: explicit correlation input -> `AURORAFLOW_TEST_ID` -> `PLAYWRIGHT_TEST_ID`.
- Page object runtime loggers and self-healing artifacts share this resolution contract to keep triage metadata consistent across logs and JSON artifacts.

### Guarded Mode Dry-Run Validation

When mode is `guarded`, AuroraFlow evaluates ranked locator suggestions in dry-run mode before writing the failure artifact:

- Candidates below `SELF_HEAL_MIN_CONFIDENCE` are marked as skipped.
- With default scoring, fresh heuristic and DOM candidates remain diagnostic unless a maintainer explicitly lowers the threshold; registry-curated candidates can pass when their confidence meets the floor.
- Supported locator expressions are resolved against the current page and checked for matches and visibility.
- The first confidence-eligible visible candidate is marked as `accepted` for operator review.
- No action is auto-applied in this stage; validation is diagnostic and auditable only.
- Policy checks run before candidate validation and can block evaluation for disallowed actions/domains.

Guarded validation results are stored in `guardedValidation` with per-candidate status and accepted candidate metadata when available, plus policy decision details (`actionAllowed`, `domainAllowed`, `blockedReason`, `evaluatedDomain`).

### Guarded Auto-Apply (Single Retry)

When guarded validation produces an accepted candidate and the action is supported, AuroraFlow attempts one auto-apply retry before surfacing the original failure:

- Supported action retries: `click`, `type`, `read`, and `wait`.
- Auto-apply is attempted only for confidence-eligible, policy-allowed candidates.
- Auto-apply never suppresses a failed retry; the original action failure still propagates.
- Auto-apply outcomes are captured under `guardedAutoHeal`:
  - `attempted`, `succeeded`
  - `locator` (accepted locator expression)
  - `skippedReason` when no attempt is made
  - `errorMessage` when retry fails

### Run-Level Failure-Storm Budget

Self-healing work is counted per `AuroraFlowContext`, the run-state seam for isolated execution. The budget covers screenshot capture, SAT/DOM analysis, guarded validation, guarded auto-apply, registry writes, and failure-artifact volume.

The budget aggregates only across page objects that share one context. A `PageFactory` provider that forwards `runtimeContext` — including through the context-bound `PageFactory` the `auroraflow/playwright` fixture exposes — gives those page objects the same context and therefore one shared run-level budget. Default-constructed page objects (`new SomePage(page)`, or `PageFactory.getPage()` without a registered provider) keep their constructor's second argument domain-owned and build their own env-backed context, so each holds an independent budget rather than a single process-wide quota.

When self-healing is `off`, AuroraFlow skips all self-healing analysis and writes no self-healing failure-event artifact. A basic failure screenshot is still captured as failure evidence when the artifact privacy policy allows it: `off` disables the self-healing event record, not basic screenshot capture.

Per `AUR-DEC-013`, defaults are baseline-first and warning-only:

- `SELF_HEAL_RUN_BUDGET_MODE=warning_only` emits one warning after either budget is exceeded, but it does not block diagnostics.
- `SELF_HEAL_RUN_BUDGET_MODE=enforce` first downgrades failures beyond `SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS` to capture-only artifacts.
- Once `SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS` is exceeded, failures become original-error-only for the rest of the run.
- Budget downgrades do not auto-apply guarded locators, write pending registry telemetry, mutate selector records, or change source selectors.
- The original page-action failure stays primary; a failed guarded retry never replaces the propagated cause.

### Write-Pending Registry Telemetry

When `SELF_HEAL_REGISTRY_MODE=write_pending` and a registry runtime is configured, AuroraFlow writes bounded SAT telemetry after the failure artifact event ID is allocated:

- candidate history observations for SAT-ranked candidates, with validation status and guarded auto-apply outcome.
- pending promotion records only when guarded auto-apply succeeds, a stable `selectorId` and base selector version are known, and the accepted locator differs from the active selector.
- Atomic Redis/store counter merges for candidate history observations; Redis uses backend-side Lua rather than process-local locks.
- Redis TTLs for historical SAT telemetry and pending promotion review records. Candidate-history default and maximum retention are both `2,592,000` seconds (30 days), per `AUR-DEC-005`.

Pending promotion records share `eventId`, `candidateId`, and `selectorId` with the file artifact. They are review records only; AuroraFlow does not mutate active selector records or source files in this step.

## Reviewed Promotion Workflow

Reviewed workflow commands are available through:

```bash
npm run self-heal:promotions -- list --selector-id <selector-id>
npm run self-heal:promotions -- approve --promotion-id <promotion-id> --reviewer <name>
npm run self-heal:promotions -- reject --promotion-id <promotion-id> --reviewer <name> --reason "<reason>"
npm run self-heal:promotions -- rollback --promotion-id <promotion-id> --reviewer <name>
npm run self-heal:promotions -- cleanup
```

Behavior:

- `list` returns pending review records, with optional selector/candidate filters.
- `approve` requires reviewer identity, applies the proposed locator with expected-version compare-and-set, writes audit metadata, and marks conflicts explicitly.
- `reject` requires reviewer identity and a reason, marks the promotion rejected, and accounts candidate rejection history.
- `rollback` restores the previous selector snapshot with compare-and-set, writes rollback audit metadata, and accounts rollback history.
- `cleanup` dry-runs by default; pass `--apply` to remove expired history, promotion, and audit records from non-active keyspaces.

Local promotion authorization remains permissive and emits a warning. Shared promotion mode (`--authorization-mode shared` or `SELF_HEAL_PROMOTION_AUTHORIZATION_MODE=shared`) requires CODEOWNERS plus protected workflow evidence before mutating selectors. Statuses include `pending`, `approved`, `applied`, `rejected`, `conflict`, and `rolled_back`. Status updates use expected-status compare-and-set, so concurrent approve/reject/rollback races conflict instead of silently overwriting active selector or promotion records.

## CI Governance and Triage

AuroraFlow includes a governance pass for self-healing artifacts in CI:

- Command: `npm run self-heal:governance`
- Default artifact source: `test-results/self-healing`
- Governance outputs:
  - JSON summary: `test-results/self-healing-governance-summary.json`
  - Markdown summary: `test-results/self-healing-governance-summary.md`
- Governance telemetry aggregates:
  - event counts by mode.
  - event counts by action type.
  - pending promotion write status counts.
  - event counts by error code.
  - guarded auto-heal attempted/succeeded/failed/skipped counters.

### Acknowledgement Gate

- `SELF_HEAL_REQUIRE_ACK_FOR_ACCEPTED` controls whether guarded accepted candidates require explicit acknowledgement (default `true`).
- `SELF_HEAL_ACKNOWLEDGED=true` acknowledges reviewed guarded accepted candidates and allows the governance step to pass.
- If guarded accepted candidates exist and acknowledgement is missing, governance fails with a blocking signal.

### Optional Auto-Triage Issue

- CI can open a triage issue automatically when guarded accepted candidates are detected.
- Enable with repository variable `SELF_HEAL_AUTO_OPEN_TRIAGE_ISSUE=true`.
- Auto-triage runs on `main` only and uses the governance markdown summary as issue body.
