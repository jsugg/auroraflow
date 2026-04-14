# Data Provider Examples

## Why This Exists
These examples show a provider abstraction that keeps tests deterministic locally while enabling a Redis-backed path for shared selector or test-data registries.

## Files
- `in-memory-data-provider.ts`: deterministic local provider for unit and fixture-driven tests.
- `redis-data-provider.ts`: namespaced Redis provider contract example.
- `types.ts`: shared provider interface.

## Common Failure Mode
Mixing direct Redis calls into page objects bypasses provider boundaries and makes local deterministic test runs harder to maintain.

## Local Redis Workflow
Use the repository compose helpers when you want an always-on Redis process for local iteration:

```bash
npm run infra:redis:up
npm run test:integration
npm run infra:redis:down
```
