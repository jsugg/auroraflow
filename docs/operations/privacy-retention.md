# Artifact Privacy and Retention

AuroraFlow treats test evidence as potentially sensitive even when tests use synthetic data. The current product scope covers synthetic data and non-production PII only. AuroraFlow does not claim support for regulated PII, production data, legal holds, or compliance-grade data-loss prevention.

## Data Classes

| Data class | Typical content | Sensitivity | Current control |
| --- | --- | --- | --- |
| Screenshots | Rendered page content, account details, form values, notifications | High | Compatible preset captures failure screenshots. Sensitive preset disables them. Custom policies can supply Playwright mask selectors. |
| DOM text | Visible text, accessible names, labels, placeholders, titles | High | Bounded by node/text limits. Sensitive preset removes text-bearing fields before candidate extraction. Redact, keyed-hash, and disable modes are available to custom policies. |
| Failure events | URLs, selectors, errors, candidate evidence, screenshot paths | High | JSON schema, bounded candidate data, optional screenshot path, privacy-aware DOM candidates. URLs/selectors/errors remain potentially sensitive. |
| Logs | Action messages, errors, correlation identifiers, structured metadata | Medium-High | Secret-shaped fields are redacted by default. Destinations and extra redaction paths are consumer-configurable. |
| Redis records | Active selectors, candidate history, pending promotions, audit context | Medium-High | Namespaced records and bounded history/pending TTLs. Redis deployment, ACLs, backups, eviction, and deletion are consumer-owned. |
| Telemetry | Action type/status, counts, durations, hashes, optional raw selectors | Medium | Raw selector export is disabled by default. OTLP destination and backend retention are consumer-owned. |
| Trends | Aggregated flakiness/SLO points, branch/commit/workflow metadata | Low-Medium | JSONL point-count bounds; CI cache/artifact storage is consumer-owned and not a durable analytics guarantee. |
| Audit records | Promotion reviewer/action/time and selector-change context | Medium-High | Audit writes carry 30-day expiry metadata by default; cleanup is dry-run unless explicitly applied, and `legalHold: true` records are skipped. |

Structural fields such as URLs, selectors, element IDs, test IDs, CSS paths, errors, and consumer-added metadata can still contain sensitive values. Privacy presets reduce capture; they do not discover arbitrary PII.

## Capture Policies

Set `AURORAFLOW_ARTIFACT_PRIVACY_PRESET` to one of:

| Preset | Screenshots | DOM text | Compatibility |
| --- | --- | --- | --- |
| `compatible` | Captured on page-action failure | Captured under existing SAT bounds | Default; preserves existing capture behavior. |
| `sensitive` | Disabled | Visible text, accessible names, and text-bearing attributes omitted before candidate extraction | Opt-in for synthetic/non-production sensitive fixtures. |

Invalid preset values fall back to `compatible` and emit a diagnostic without echoing the received value.

The experimental `ArtifactPrivacyPolicy` surface also supports:

- screenshot masking through explicit Playwright selectors and mask color;
- DOM text replacement with `[redacted]`;
- keyed HMAC-SHA256 values for correlation without retaining plaintext;
- complete DOM text omission.

Custom policies can be passed to the exported capture/analyzer functions. `PageObjectBase` subclasses can override the protected privacy-policy resolver until runtime-context injection provides a constructor-level seam. Hash keys and mask selectors are application configuration and must not be committed.

The sensitive preset intentionally favors privacy over text-derived healing quality. Stable test IDs, roles without names, and bounded CSS evidence may remain. Artifact schema versions stay at `1.0.0`: screenshots were already optional, and DOM text fields were already optional strings, so omission/redaction is additive and legacy readers remain valid.

## Retention Guidance

Retention below is operational guidance unless marked **enforced**. Use the shortest duration that supports triage and delete sooner when evidence is no longer useful.

| Storage/data | Guidance | Enforcement and owner |
| --- | --- | --- |
| Local screenshots, failure events, DOM snapshots, reports | Delete after triage; target 72 hours or less when non-production PII may be present. | No automatic local cleanup. Consumer-owned workspace. |
| CI test artifacts | Prefer 7 days; do not exceed 14 days for sensitive test evidence without review. | Repository workflows currently use 7-14-day artifact retention for test evidence. Consumer-owned CI settings may differ. |
| Logs | Prefer 7 days or less for detailed action/error logs; keep only aggregated operational counts longer. | Consumer-owned filesystem/log backend. Redaction does not replace deletion. |
| Telemetry | Prefer 7 days or less for detailed traces; aggregate metrics may use a longer consumer-approved window. | Consumer-owned OTLP backend and retention policy. |
| Selector candidate history | 30-day default and hard cap; choose a shorter positive TTL when practical. | **Enforced** by AuroraFlow Redis writes. Redis itself remains consumer-owned. |
| Pending selector promotions | 30-day default; review or remove sooner. | **Enforced** by AuroraFlow Redis writes unless a shorter caller-supplied TTL is used. |
| Active selector records | Retain only while the selector is active and needed. | No time TTL by default; consumer/operator lifecycle. |
| Audit records | Target 30 days for ordinary non-production review evidence; longer retention requires a separate policy decision. | **Enforced for new workflow writes** through audit TTL metadata. Cleanup defaults to dry-run and excludes `legalHold: true` records unless operators export/delete them under a separate policy. |
| Trend JSONL and CI trend artifacts | Keep only the bounded window needed for flakiness/SLO review; target 30 days or less for copied/exported files. | Point-count bounds apply; CI cache eviction is not a deletion SLA. [Durable export](./trend-durable-export.md) remains optional and operator-owned. |
| Release dry-run evidence | 30 days in this repository; should not contain page captures or test credentials. | **Enforced** by the repository release workflow artifact setting. |

CI, Redis, log, telemetry, and observability storage are consumer-owned. AuroraFlow does not operate production Redis, CI artifact storage, or an observability backend. Redis prefixes are namespace hygiene, not authorization; see the [Redis production runbook](./redis-production-runbook.md) for TLS, auth, ACL, backup/restore, eviction, capacity, retention, and incident guidance.

## Required Operating Practices

1. Use synthetic values or dedicated non-production test accounts.
2. Select `sensitive` before running against pages that can display non-production PII or secrets.
3. Keep raw selector telemetry disabled outside isolated local debugging.
4. Configure CI artifact expiration and backend deletion independently of AuroraFlow.
5. Restrict Redis and observability access with least privilege, transport encryption, and isolated namespaces.
6. Treat shared artifacts as exposed if a synthetic-secret regression fails; delete evidence and rotate any affected non-production credential.

These controls are defense-in-depth for test automation. They are not a certification, a PII detector, or authorization to use regulated/prod-like data.
