# Security Policy

## Supported versions

AuroraFlow is a single-package npm library. Security fixes target the default branch and the latest released `1.x` line once public releases begin. Older development snapshots, forks, and unpublished local builds are not supported unless a maintainer explicitly backports a fix.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository when available. If that path is unavailable, open a GitHub issue that asks for a private coordination channel and does not include exploit details, secrets, tokens, private URLs, or customer data.

Please include:

- affected AuroraFlow version or commit SHA;
- minimal reproduction steps;
- impact and affected component;
- whether the issue involves self-healing artifacts, Redis selector data, telemetry/exported attributes, GitHub Actions, or package publishing.

The maintainer will acknowledge valid reports as soon as practical, coordinate the fix privately when needed, and publish remediation notes after the issue can be safely disclosed.

## Scope

In scope:

- vulnerabilities in the AuroraFlow TypeScript library;
- CI/CD supply-chain controls for this repository;
- package metadata, exports, generated artifacts, and release dry-run evidence;
- default logging, telemetry, Redis selector-registry, and self-healing artifact behavior.

Out of scope:

- hosted service, container, Kubernetes, or database deployment controls; this project does not ship those surfaces;
- consumer-owned Redis, observability, CI runner, and retention infrastructure;
- vulnerabilities that require leaking real secrets in a public issue or pull request.

Do not submit real credentials or sensitive production data. Use synthetic fixtures only.
