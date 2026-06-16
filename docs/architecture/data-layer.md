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
  - typed selector record schema.
  - Redis-agnostic repository contract (`SelectorStore`).
  - deterministic `upsert`, `get`, `listAll`, `listByPageObject`, `listByPageObjectAndAction`, and `delete` behavior.
  - optional `expectedVersion` concurrency checks for reviewed selector promotion workflows.
  - page/action index keys for bounded runtime lookup without scanning all active selectors.
  - distinct namespaces for active records, indexes, candidate history, pending promotions, and audit records.
  - large-registry listing via cursor key scans plus bounded batched payload reads.
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
- Stale expected-version writes throw `SelectorRegistryConflictError` and do not overwrite active records.
- Candidate-history writes require `SelectorStore.atomicJsonMerge`; Redis implements this as one Lua `EVAL`, and the memory store implements it within one process. Missing atomic merge support fails write paths explicitly.
- Candidate-history TTL follows shortest-useful retention: default and hard cap are both `2,592,000` seconds (30 days), and higher custom TTLs are clamped.
- The memory store advertises `durability: 'non-durable'`; closing or process exit loses all records.

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
