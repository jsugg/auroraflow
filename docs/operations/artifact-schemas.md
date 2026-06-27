# Artifact Schema Compatibility

AuroraFlow ships JSON Schemas under `schemas/` and executable compatibility fixtures under `tests/fixtures/artifacts/`. Schemas are public package assets. Fixtures are repository test assets that freeze each supported read contract before producers or consumers change.

## Published v1 contracts

| Data | Schema | Version marker |
| --- | --- | --- |
| Self-healing failure event | `self-healing-failure-event.schema.json` | `artifactVersion: "1.0.0"` |
| DOM snapshot | `dom-snapshot.schema.json` | `schemaVersion: "1.0.0"` |
| Selector registry record | `selector-registry-record.schema.json` | `schemaVersion: "1.0.0"` |
| Observability trend point | `observability-trend-point.schema.json` | `schemaVersion: "1.0.0"` |
| Selector candidate history | `selector-candidate-history.schema.json` | v1 schema/fixture path |
| Pending selector promotion | `pending-selector-promotion.schema.json` | v1 schema/fixture path |
| Self-healing governance summary | `self-healing-governance-summary.schema.json` | v1 schema/fixture path |
| Flakiness summary | `flakiness-summary.schema.json` | v1 schema/fixture path |
| SLO dashboard | `slo-dashboard.schema.json` | v1 schema/fixture path |
| SLO alert evaluation | `slo-alert-evaluation.schema.json` | v1 schema/fixture path |

Canonical current fixtures live in `tests/fixtures/artifacts/v1/`. `npm run schemas:check` compiles every published schema. Unit compatibility tests validate each v1 fixture and exercise runtime parsers where one exists.

## Reader policy

AuroraFlow classifies reads by boundary instead of silently coercing incompatible data:

| Case | Required behavior | Reason |
| --- | --- | --- |
| Current published v1 fixture | **Must read** | Patch/minor releases must not strand supported CI/report artifacts. |
| Unversioned selector registry record created before schema versioning | **Must read and upgrade in memory** | Existing active selectors remain usable; new writes always emit current schema. |
| Unknown future version in a tolerant multi-record stream | **Skip with warning** | One future/corrupt trend line must not hide readable historical points. |
| Unknown future version at a direct parser, registry, schema, or strict stream boundary | **Hard reject** | Callers asked for one authoritative object; guessing could produce incorrect governance or repair decisions. |
| Malformed current-version object | **Hard reject**, except tolerant streams | Matching version does not permit invalid types or missing required fields. |

Today, `readObservabilityTrendPoints()` is the tolerant stream boundary. Default mode skips an unknown/malformed line and emits file, line, and parser diagnostic through `onWarning`. `strict: true`, `parseObservabilityTrendPoint()`, self-healing artifact parsers, selector registry reads, and JSON Schema validation reject same incompatible input.

Unknown future versions are never interpreted as current. Consumers may preserve skipped bytes for a newer reader, but must not merge them into current summaries.

## Evolution rules

- Additive optional fields may ship within v1; readers ignore fields they do not use.
- Removing/renaming required fields, changing field meaning/type, or changing enum semantics requires new versioned schema and migration notes.
- Producer must land new fixture, schema, reader policy, and compatibility tests before emitting new version.
- Current public v1 fixtures remain must-read for supported release line. Removing support requires documented major-version decision.
- Self-healing suggestions may include optional `candidateLocator` objects with their own `schemaVersion`; legacy suggestions containing only display `locator` strings remain readable.

## Selector registry migration and repair

Current selector records contain `schemaVersion: "1.0.0"`. Read-time parsing adds that version to legacy unversioned records without mutating Redis. Audit persistent records and page/action indexes with:

```bash
npm run self-heal:repair
```

Dry-run is default. It reports legacy, malformed, truncated, missing, stale, mismatched, and unverifiable records/indexes. After backup and review, apply idempotent repair with:

```bash
npm run self-heal:repair -- --apply
```

Legacy upgrades use compare-and-set on record `version`; concurrent changes become conflicts instead of overwrites. Index repair creates missing keys, fixes wrong targets, and deletes only indexes proven stale from scanned active records. Unverifiable indexes remain. Re-run dry-run until drift is zero; do not hand-edit shared registries.

## Validation

```bash
npm run schemas:check
npm run test:unit -- --run tests/suites/unit/framework/selfHealing/artifactCompatibility.spec.ts
```

Generated artifacts under `test-results/` and JSONL trend files under `test-results/` or `.auroraflow-trends/` are also validated when present.

Screenshot paths and DOM text remain optional under v1. Sensitive privacy controls may omit them without version change. See [Artifact privacy and retention](./privacy-retention.md).
