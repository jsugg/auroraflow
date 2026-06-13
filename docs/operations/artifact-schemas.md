# Artifact Schemas

AuroraFlow publishes JSON Schemas for generated governance and observability artifacts under `schemas/`.

## Schema Files

- `self-healing-failure-event.schema.json`
- `dom-snapshot.schema.json`
- `selector-candidate-history.schema.json`
- `pending-selector-promotion.schema.json`
- `self-healing-governance-summary.schema.json`
- `flakiness-summary.schema.json`
- `slo-dashboard.schema.json`
- `slo-alert-evaluation.schema.json`
- `observability-trend-point.schema.json`

Run validation with:

```bash
npm run schemas:check
```

The command compiles all schema files and validates generated artifacts found under `test-results/`. It also validates JSONL trend points in `test-results/*trend*.jsonl` and `.auroraflow-trends/*trend*.jsonl`. When no artifacts are present, it still verifies that every schema compiles.

## Compatibility Policy

- Schema IDs and artifact versions currently use `1.0.0`.
- Required fields describe the current generated artifact contracts.
- Additive fields are allowed so artifact consumers can adopt new metadata without breaking old readers.
- Type changes, removed required fields, or renamed fields require a new schema ID/version and migration notes.

## Runtime Status

These schemas define contracts for current artifacts, selector-history records, pending promotion review records, and observability trend points. Pending promotion records are runtime-written in `SELF_HEAL_REGISTRY_MODE=write_pending`; reviewed approval/rejection/rollback workflows operate on registry records only and do not rewrite source code.

Selector-candidate-history records use the `AUR-DEC-005` shortest-useful retention contract: default TTL and hard cap are both `2,592,000` seconds (30 days), and `expiresAt` mirrors the clamped TTL. Redis persistence is consumer-owned; applications may choose shorter custom TTLs.

Screenshot paths and DOM text fields are optional under the existing `1.0.0` schemas. The sensitive privacy preset can omit them without a schema-version change; legacy readers remain valid. See [Artifact privacy and retention](./privacy-retention.md).
