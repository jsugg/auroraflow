# Data Layer Foundation

This document defines the current selector-store data layer primitives available in AuroraFlow.

## Implemented Modules

- `src/utils/redisClient.ts`
  - strict runtime config parsing from environment variables.
  - bounded retry with exponential backoff + jitter.
  - namespaced key behavior through `AURORAFLOW_REDIS_KEY_PREFIX`.
  - cursor-based key discovery through `SCAN`/`scanKeys()` instead of blocking `KEYS`.
  - batched value loading through `mget()` for list/read-heavy registry paths.
  - atomic JSON record compare-and-set through Redis `EVAL` for versioned selector writes.
  - atomic JSON merge through Redis `EVAL` for selector-candidate-history counters.
  - explicit connection lifecycle with `connect()` and `disconnect()`.
- `src/data/selectors/selectorRegistry.ts`
  - typed `1.0.0` selector record schema and read-time upgrader for unversioned legacy records.
  - Redis-agnostic repository contract (`SelectorStore`).
  - deterministic `upsert`, `get`, `listAll`, `listByPageObject`, `listByPageObjectAndAction`, and `delete` behavior.
  - optional `expectedVersion` concurrency checks for reviewed selector promotion workflows.
  - page/action index keys for bounded runtime lookup without scanning all active selectors.
  - distinct namespaces for active records, indexes, candidate history, pending promotions, and audit records.
  - large-registry listing via cursor key scans plus bounded batched payload reads.
- `scripts/self-healing-registry-repair.ts`
  - bounded schema/index audit with dry-run default.
  - compare-and-set legacy upgrades plus idempotent missing/stale/mismatched index repair.
  - retains malformed or otherwise unverifiable index targets instead of guessing.
- `src/data/selectors/redisSelectorStore.ts`
  - Redis-backed `SelectorStore` adapter with TTL, compare-and-set, and atomic JSON merge support.
- `src/data/selectors/memorySelectorStore.ts`
  - process-local, non-durable `SelectorStore` adapter for tests and local experiments.
  - supports TTL, deterministic clock injection, `getMany`, `scanKeys`, compare-and-set, atomic JSON merge, `clear()`, and idempotent `close()`.
  - not shared across workers or processes and not a durable registry backend.
- `src/framework/selfHealing/registryRuntime.ts`
  - runtime adapter that exposes active selectors, candidate history, and pending promotion repositories to SAT without coupling analyzer code to Redis.
  - read-mode resolver stays opportunistic unless Redis environment variables are present or `SELF_HEAL_REGISTRY_REQUIRED=true`.

## Environment Variables

- `AURORAFLOW_REDIS_URL` (optional): full Redis URL (`redis://` or `rediss://`).
- `AURORAFLOW_REDIS_HOST` (default: `127.0.0.1`)
- `AURORAFLOW_REDIS_PORT` (default: `6379`)
- `AURORAFLOW_REDIS_DB` (default: `0`)
- `AURORAFLOW_REDIS_USERNAME` (optional)
- `AURORAFLOW_REDIS_PASSWORD` (optional)
- `AURORAFLOW_REDIS_TLS` (default: `false`)
- `AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS` (default: `5000`)
- `AURORAFLOW_REDIS_MAX_RETRIES` (default: `3`)
- `AURORAFLOW_REDIS_BASE_BACKOFF_MS` (default: `50`)
- `AURORAFLOW_REDIS_MAX_BACKOFF_MS` (default: `2000`)
- `AURORAFLOW_REDIS_KEY_PREFIX` (default: `auroraflow`)
- `SELF_HEAL_REGISTRY_REQUIRED` (default: `false`): require registry runtime resolution for SAT reads.
- `SELF_HEAL_REGISTRY_NAMESPACE` (default: `selector-registry`): active selector namespace used by SAT registry runtime adapters.

## Usage Example

```ts
import { SelectorRegistryRepository, createRedisSelectorStore, getRedisClient } from 'auroraflow';

const redisClient = getRedisClient();
await redisClient.connect();

const registry = new SelectorRegistryRepository({
  namespace: 'selector-registry',
  store: createRedisSelectorStore(redisClient),
});

await registry.upsert({
  id: 'login.submit',
  pageObjectName: 'LoginPage',
  actionType: 'click',
  locator: "page.getByRole('button', { name: 'Sign in' })",
  confidence: 0.95,
});

await registry.upsert(
  {
    id: 'login.submit',
    pageObjectName: 'LoginPage',
    actionType: 'click',
    locator: "page.getByRole('button', { name: 'Log in' })",
    confidence: 0.96,
  },
  { expectedVersion: 1 },
);
```

For local non-durable use:

```ts
import { SelectorRegistryRepository, createMemorySelectorStore } from 'auroraflow';

const memoryStore = createMemorySelectorStore();
const localRegistry = new SelectorRegistryRepository({
  namespace: 'selector-registry-local',
  store: memoryStore,
});

await localRegistry.upsert({
  id: 'checkout.submit',
  pageObjectName: 'CheckoutPage',
  actionType: 'click',
  locator: '#submit',
});

memoryStore.clear();
await memoryStore.close();
```

## Failure Semantics

- Invalid runtime configuration throws `RedisConfigError` at construction time.
- Connection setup failures throw `RedisConnectionError`.
- Exhausted operation retries throw `RedisOperationError` with operation name and attempts.
- Invalid selector payload/schema throws `SelectorRegistryValidationError` or `SelectorRegistryDataError`.
- Unknown future selector record versions hard-fail reads; unversioned legacy records remain readable and are normalized to current schema in memory.
- Stale expected-version writes throw `SelectorRegistryConflictError` and do not overwrite active records.
- Candidate-history writes require `SelectorStore.atomicJsonMerge`; Redis implements this as one Lua `EVAL`, and the memory store implements it within one process. Missing atomic merge support fails write paths explicitly.
- Candidate-history TTL follows shortest-useful retention: default and hard cap are both `2,592,000` seconds (30 days), and higher custom TTLs are clamped.
- The memory store advertises `durability: 'non-durable'`; closing or process exit loses all records.

## Store Support Tiers and Extensibility

`MemorySelectorStore` is a supported non-durable tier for unit tests, fixture-scoped state, process-boundary CLI checks, and local experiments. It is not a durable CI, team, or shared-registry backend. Use Redis when selector records must survive process exit or be shared across workers, jobs, or machines.

New selector-store backends remain evidence-gated. They require user demand, a named owner, shared `SelectorStore` conformance, real-backend consistency proof, security and operations documentation, compatibility planning, and release validation before implementation. See [Adoption Readiness and Extensibility Gates](./adoption-readiness.md) for the backend-extensibility criteria and memory-store tier decision.

## Integration Testing

- Integration suite location: `tests/suites/integration/framework/data/redisIntegration.spec.ts`
- Runtime model: ephemeral Redis container via Testcontainers (`redis:7.2-alpine`).
- Command:

```bash
npm run test:integration
```

Behavior notes:

- When Docker is available, tests validate real Redis connectivity, namespaced key behavior, TTL handling, selector registry versioning, Redis-backed CAS, atomic candidate-history counters, store conformance, and indexed selector lookup.
- When Docker/Testcontainers is unavailable, tests skip with an explicit reason rather than hanging.
- Unit tests run the same store conformance suite against `MemorySelectorStore`.

## Production Operations Boundary

Redis is the first durable selector-store backend, but deployments are consumer/operator-owned. AuroraFlow owns client behavior and store contracts; it does not own Redis provisioning, TLS termination, ACLs, backups, restore drills, eviction policy, capacity, retention outside live-key TTLs, or incidents.

Use `AURORAFLOW_REDIS_KEY_PREFIX` and `SELF_HEAL_REGISTRY_NAMESPACE` to keep key spaces understandable and cleanup-safe. These prefixes are namespace hygiene, not authorization. Production isolation must come from Redis credentials, ACLs, network policy, database/instance separation, and reviewed promotion controls.

See [Redis Selector Registry Production Runbook](../operations/redis-production-runbook.md) for the TLS/auth/ACL/prefix/backup/restore/eviction/retention/capacity/incident checklist.

Shared registries should run `npm run self-heal:repair` after restore or suspected index drift. Command scans at most 1,000 active records and index keys by default, reports truncation, and does not mutate data unless `--apply` is explicit. Large registries require repeated bounded passes or operator-approved higher limit; this CLI is repair tooling, not an unbounded online migration framework.

## Local Redis Orchestration (Docker Compose)

When you want a persistent local Redis instance for manual debugging or iterative integration runs:

```bash
npm run infra:redis:up
npm run test:integration
```

Or use the convenience wrapper:

```bash
npm run test:integration:local
```

Inspect Redis service logs:

```bash
npm run infra:redis:logs
```

Cleanup local runtime side effects:

```bash
npm run infra:redis:down
```
