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
