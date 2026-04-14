# Data Layer Foundation

This document defines the current Redis-backed data layer primitives available in AuroraFlow.

## Implemented Modules

- `src/utils/redisClient.ts`
  - strict runtime config parsing from environment variables.
  - bounded retry with exponential backoff + jitter.
  - namespaced key behavior through `AURORAFLOW_REDIS_KEY_PREFIX`.
  - explicit connection lifecycle with `connect()` and `disconnect()`.
- `src/data/selectors/selectorRegistry.ts`
  - typed selector record schema.
  - Redis-agnostic repository contract (`SelectorStore`).
  - deterministic `upsert`, `get`, `listAll`, `listByPageObject`, and `delete` behavior.

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

## Usage Example

```ts
import { getRedisClient } from '../../src/utils/redisClient';
import { SelectorRegistryRepository } from '../../src/data/selectors/selectorRegistry';

const redisClient = getRedisClient();
await redisClient.connect();

const registry = new SelectorRegistryRepository({
  namespace: 'selector-registry',
  store: {
    get: (key) => redisClient.get(key),
    set: (key, value) => redisClient.set(key, value),
    del: (key) => redisClient.del(key),
    keys: (pattern) => redisClient.keys(pattern),
  },
});

await registry.upsert({
  id: 'login.submit',
  pageObjectName: 'LoginPage',
  actionType: 'click',
  locator: "page.getByRole('button', { name: 'Sign in' })",
  confidence: 0.95,
});
```

## Failure Semantics

- Invalid runtime configuration throws `RedisConfigError` at construction time.
- Connection setup failures throw `RedisConnectionError`.
- Exhausted operation retries throw `RedisOperationError` with operation name and attempts.
- Invalid selector payload/schema throws `SelectorRegistryValidationError` or `SelectorRegistryDataError`.

## Integration Testing

- Integration suite location: `tests/suites/integration/framework/data/redisIntegration.spec.ts`
- Runtime model: ephemeral Redis container via Testcontainers (`redis:7.2-alpine`).
- Command:

```bash
npm run test:integration
```

Behavior notes:

- When Docker is available, tests validate real Redis connectivity, namespaced key behavior, TTL handling, and selector registry versioning.
- When Docker/Testcontainers is unavailable, tests skip with an explicit reason rather than hanging.

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
