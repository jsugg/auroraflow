# Secrets Management Policy

This document defines the minimum secret-handling requirements for AuroraFlow development and CI.

## Scope

- GitHub Actions secrets and variables used by repository workflows.
- Test credentials and integration endpoints used by local and CI runs.
- API tokens used by automation helpers and external services.

## Required Controls

1. Store secrets only in GitHub encrypted secrets or local environment variables outside versioned files.
2. Never commit credentials in source, test fixtures, or workflow files.
3. Use least-privilege credentials for CI and test automation.
4. Rotate secrets regularly and immediately after suspected exposure.

## Rotation Policy

- CI tokens: rotate every 90 days.
- Test account passwords/API tokens: rotate every 60 days.
- Emergency rotation: within 24 hours of leak detection.

## CI Enforcement

- `security.yml` runs:
  - dependency review,
  - npm audit gate,
  - workflow security scan (zizmor),
  - gitleaks secret scan.
- `Security Gate` blocks merge when any required security job fails.

## Local Development Rules

1. Use a local `.env` file that is gitignored or export variables from shell profile.
2. Redact secret values from logs and screenshots before sharing artifacts.
3. Use dedicated non-production credentials for all automated tests.

## Incident Response

1. Revoke/rotate the exposed secret immediately.
2. Open a security incident ticket with scope and timeline.
3. Remove leaked values from history when required.
4. Add a regression check or policy update to prevent recurrence.
