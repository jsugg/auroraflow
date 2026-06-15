# ADR 0002: API stability tiers

- Status: Accepted
- Date: 2026-06-15
- Related: `AUR-ARCH-008`, `AUR-ARCH-009`, `AUR-ARCH-031`, `AUR-DEC-001`, `AUR-DEC-012`, `AUR-IMPL-009`, `AUR-IMPL-010`
- Owners: maintainer / API governance

## Context

The root package exports stable page-object APIs alongside advanced stores, telemetry wiring, and experimental self-healing internals. Without tiers, internal seams become accidental semver commitments.

## Decision

Every root export is classified in [`docs/api-stability.md`](../api-stability.md) as stable, advanced, experimental, deprecated, or internal. Package-surface tests enforce zero unclassified or stale exports.

Compatibility policy:

- stable exports break only in a major release after the documented deprecation window;
- advanced exports are supported but may have a shorter deprecation window;
- experimental exports may change in minor releases with changelog notice;
- internal exports carry no compatibility promise;
- compatibility surfaces also include shipped schemas, metric names, documented environment variables, and repository CLI outputs.

## Consequences

Maintainers can evolve internal seams without promising every export is stable. Consumers get clear upgrade expectations before depending on lower-level integration surfaces.

## Revisit triggers

Revisit when adoption evidence justifies promoting an experimental or advanced surface, or when a major release proposal needs deprecations or removals.
