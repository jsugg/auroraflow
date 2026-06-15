# ADR 0006: Release policy

- Status: Accepted
- Date: 2026-06-15
- Related: `AUR-ARCH-009`, `AUR-ARCH-034`, `AUR-ARCH-035`, `AUR-DEC-001`, `AUR-DEC-012`, `AUR-IMPL-010`, `AUR-IMPL-016`
- Owners: maintainer / release and security reviewers

## Context

AuroraFlow targets public npm library distribution. Releases need supply-chain evidence and rollback policy, but real publishing must not be reachable from routine CI before maintainer readiness.

## Decision

Release governance follows [`docs/operations/release-process.md`](../operations/release-process.md):

- releases follow SemVer against the API stability tiers;
- changelogs are curated from Conventional Commits and must call out compatibility changes;
- dry-run release evidence includes package contents, SBOMs, provenance-readiness checks, and a changelog draft;
- public publish path should use npm provenance and SBOMs;
- artifact signing is deferred until release readiness and key ownership exist;
- real publishing requires a future protected, maintainer-approved workflow;
- rollback prefers deprecating a bad npm version and publishing a fixed version rather than unpublishing by default.

## Consequences

The release path is auditable before first publish and avoids accidental package publication. Future publishing still needs maintainer readiness, credentials/OIDC setup, and protected-environment review.

## Revisit triggers

Revisit when the first real release is scheduled, when signing ownership exists, or when a supply-chain requirement changes.
