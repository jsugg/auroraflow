# ADR 0004: Redis strategy

- Status: Accepted
- Date: 2026-06-15
- Related: `AUR-DEC-005`, `AUR-DEC-006`, `AUR-DEC-007`
- Owners: maintainer / data and SRE reviewers

## Context

AuroraFlow needs durable selector registry and candidate-history primitives, but it must not imply that the library operates consumer infrastructure. Redis prefixing improves namespace hygiene, not authorization.

## Decision

Redis remains optional and consumer/operator-owned:

- local development and basic page-object use must not require Redis;
- Redis is the first durable selector-registry backend;
- the in-memory store is non-durable and appropriate for tests/local experiments only;
- candidate-history and selector writes use backend atomicity where required;
- retention defaults favor shortest useful duration and consumer-owned cleanup;
- key prefixes are not access control;
- shared registry and shared promotion workflows remain unsupported until policy, protected review, and tenancy rules exist.

## Consequences

The package can offer useful durable registry primitives without becoming a managed data service. Operators remain responsible for TLS, ACLs, backups, restore, eviction, capacity, retention, and incident response. The Redis production runbook in [`../operations/redis-production-runbook.md`](../operations/redis-production-runbook.md) documents these responsibilities without shifting ownership to AuroraFlow.

## Revisit triggers

Revisit if a shared-registry policy, operator owner, and protected promotion workflow are approved for a durable multi-team registry.
