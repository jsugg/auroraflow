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

Run validation with:

```bash
npm run schemas:check
```

The command compiles all schema files and validates generated artifacts found under `test-results/`. When no artifacts are present, it still verifies that every schema compiles.

## Compatibility Policy

- Schema IDs and artifact versions currently use `1.0.0`.
- Required fields describe the current generated artifact contracts.
- Additive fields are allowed so artifact consumers can adopt new metadata without breaking old readers.
- Type changes, removed required fields, or renamed fields require a new schema ID/version and migration notes.

## Runtime Status

These schemas define contracts for current artifacts plus future selector-history and promotion records. Selector registry history and pending promotion writes are still planned runtime work; schemas alone do not make SAT autonomous.
