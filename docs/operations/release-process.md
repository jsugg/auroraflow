# Release Process

This document defines the release policy for the `auroraflow` npm package: how release candidates are validated, what supply-chain evidence each release must produce, how changelogs are written, and how a bad release is rolled back.

Policy source: `AUR-DEC-012` (see `docs/architecture/decision-log.md`) — npm provenance and SBOM are required for this public library; artifact signing is deferred until the product demonstrates release readiness.

## Current state: dry-run only

The release workflow (`.github/workflows/release.yml`) is manual (`workflow_dispatch`) and **never publishes**. It exists to make the release path auditable before the first publish:

- The workflow has read-only (`contents: read`) permissions in every job.
- No job invokes `npm publish`; packaging produces a local `npm pack` tarball only for validation and evidence.
- The `publish-gate` job is a placeholder. It only runs when the `publish_confirmation` input is non-empty, requires the protected `release` environment, and then refuses with a hard failure. Enabling a real publish is a separate future task and requires maintainer sign-off.

Run it from the repository:

```bash
gh workflow run release.yml
```

## Dry-run evidence

Each run uploads a `release-dry-run-evidence` artifact (30-day retention) containing:

| File | Purpose |
| --- | --- |
| `pack-report.json` | Exact file list and sizes `npm pack` would publish |
| `consumer-smoke.txt` | Temp-project install/import/typecheck proof for the packed tarball |
| `publint.txt` | `publint` compatibility report for package metadata and exports |
| `attw.txt` | Are The Types Wrong report for package declaration resolution |
| `sbom.spdx.json` | SPDX SBOM of runtime dependencies (`npm sbom --omit dev`) |
| `sbom.cyclonedx.json` | CycloneDX SBOM of runtime dependencies |
| `schema-validation.txt` | `npm run schemas:check` output proving artifact schemas compile before packaging |
| `provenance-readiness.txt` | Verification that package metadata satisfies npm provenance prerequisites |
| `changelog-draft.md` | Conventional Commits log since the previous tag, input for curated notes |

The run also executes the full `npm run verify` gate and a clean `npm run build` so release evidence always reflects a healthy tree. Schema validation is also recorded as standalone release evidence, even though it is part of `verify`. Package validation then:

- builds a local tarball with `npm pack --json`;
- installs that tarball into a temporary consumer project with the supported Playwright peer floor;
- imports `auroraflow` and `auroraflow/playwright`;
- instantiates the default console logger path so the runtime `pino-pretty` transport dependency is proven present;
- typechecks the installed declarations from the consumer project; and
- runs `publint` and `attw --pack .`.

## Playwright peer compatibility

The release dry run calls `.github/workflows/playwright-peer-matrix.yml` before packaging. That reusable workflow validates three lanes inside the declared `playwright >=1.59 <2` range:

- **floor:** exact `1.59.1`;
- **current:** lockfile versions installed by `npm ci`;
- **latest:** newest compatible `1.x` resolved from `^1.59.0`.

Each lane runs type checking, focused page-object/factory unit tests, and the Chrome smoke suite. Browser installation makes this matrix too expensive for routine pull-request CI, so it runs weekly, on manual dispatch, and as a release prerequisite.

## Versioning and changelog policy

- Versions follow [SemVer](https://semver.org/). Breaking changes to `stable` exports (see `docs/api-stability.md`) require a major release; the deprecation policy there governs removal timelines.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are enforced by commitlint (`commitlint.config.cjs`).
- Release notes start from the workflow's `changelog-draft.md` and are curated by the release maintainer: group by `feat`/`fix`/breaking changes, drop internal-only noise, and call out migration steps for any `advanced` or `experimental` surface changes.
- The version bump itself (`npm version`) and tag push are maintainer actions and are out of scope for the dry-run workflow.

## Provenance and SBOM policy

Per `AUR-DEC-012`:

- **npm provenance — required at publish time.** The future publish path must use npm trusted publishing from GitHub Actions OIDC (`id-token: write` granted only to the publish job). Trusted publishing eliminates long-lived npm tokens and produces provenance during the registry publish. Provenance statements cannot be produced by a dry run; the dry-run workflow instead validates the prerequisites (public package, `repository.url` matching the repository, explicit `files` allowlist).
- **SBOM — required for every release.** Generated with the npm CLI's built-in `npm sbom` in both SPDX and CycloneDX formats, restricted to runtime dependencies (`--omit dev`). The package manager is pinned to `npm@11.17.0`, and the release dry-run workflow installs that version and verifies `npm sbom --help` before dependency install and SBOM generation.
- **Artifact signing — deferred.** No Sigstore/GPG signing ceremony until the product demonstrates release readiness; revisit when the first real publish is scheduled.

## Publish gating (future publish path)

A real publish must never be reachable from a routine CI event. The gates, all of which must hold simultaneously:

1. Manual `workflow_dispatch` by a maintainer with an explicit non-empty confirmation input.
2. The protected `release` GitHub environment with required reviewers configured (the placeholder job already binds to this environment).
3. A dedicated publish job — added by a future task — mapped to an npm trusted publisher for this exact repository, workflow, and environment. No `NPM_TOKEN` or other long-lived npm publish secret may be added.

## Rollback policy

If a published release is broken or compromised:

1. **Do not `npm unpublish` by default.** Unpublish is restricted by the npm registry (broadly, within 72 hours and only when no other packages depend on the version) and breaks downstream lockfiles. Reserve it for leaked secrets or malicious artifacts within the allowed window.
2. **Deprecate the bad version** so installs warn immediately:

   ```bash
   npm deprecate auroraflow@<bad-version> "Broken release, use <fixed-version>"
   ```

3. **Publish a fixed version** (patch for regressions; new minor/major if the fix itself changes API) through the same gated release path.
4. **Update release notes** for the bad version with the failure description and the replacement version.
5. **If the workflow itself is the risk** (misconfiguration, suspected credential exposure), disable it immediately:

   ```bash
   gh workflow disable release.yml
   ```

   and rotate any affected credentials before re-enabling.

## Pre-release checklist

- [ ] `npm run verify` green on the release commit.
- [ ] `npm run schemas:check` evidence recorded in `schema-validation.txt`.
- [ ] Playwright floor/current/latest peer matrix green.
- [ ] Release dry-run workflow green; evidence artifact reviewed (pack contents, consumer smoke, publint, ATTW, SBOMs, trusted-publishing readiness, changelog draft).
- [ ] Release notes curated from the changelog draft.
- [ ] Version bump follows SemVer against `docs/api-stability.md` tiers.
- [ ] Rollback owner identified and reachable.
