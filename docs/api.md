# API

AuroraFlow's supported package API is the root import:

```ts
import { PageObjectBase, PageFactory } from 'auroraflow';
```

Repository-internal source paths are not the package contract.

Every root export carries a stability tier (stable, advanced, experimental, deprecated, or internal) with documented compatibility guarantees and a deprecation policy. The full classification is machine-readable and contract-tested; see [API stability](./api-stability.md).

## Page objects

### `PageObjectBase`

Base class for instrumented Playwright page objects.

<!-- snippet: no-compile (API signature reference, not runnable code) -->

```ts
abstract class PageObjectBase {
  protected page: Page;
  protected logger: Logger;
  protected url: string;

  constructor(page: Page, pageObjectName?: string, context?: AuroraFlowContext);
  protected initialize(): Promise<void>;

  navigateTo(url: string, options?: NavigationOptions): Promise<Response | null>;
  open(): Promise<void>;
  getTitle(): Promise<string>;
  click(selector: string, options?: ActionOptions): Promise<void | null>;
  type(selector: string, text: string, options?: ActionOptions): Promise<void | null>;
  getText(selector: string, options?: ActionOptions): Promise<string | null>;
  waitForSelector(
    selector: string,
    options?: ActionOptions,
  ): Promise<ElementHandle<unknown> | null>;
  waitForTimeout(timeout: number): Promise<this>;
  takeScreenshot(path: string): Promise<Buffer>;
  close(): Promise<void | null>;
}
```

Set `this.url` in the constructor when using `open()`. Override `initialize()` for idempotent page-specific readiness checks.

### `NavigationOptions`

```ts
interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}
```

`timeout` must be an integer between `1` and `120000` milliseconds.

### `ActionOptions`

```ts
interface ActionOptions {
  timeout?: number;
  targetAlias?: string;
  expectedRole?: string;
  expectedName?: string;
  selectorId?: string;
}
```

`timeout` must be an integer between `1` and `120000` milliseconds. Metadata fields enrich self-healing artifacts and registry lookups; they are not forwarded to Playwright actions.

### Errors

- `PageActionError`: thrown when a Playwright-backed page action fails after the safe-action boundary has logged, captured screenshots, and processed optional self-healing diagnostics.
- `PageActionInputError`: thrown before Playwright is called when caller input is invalid, such as an out-of-range timeout.

## Page factory

### `PageFactory`

<!-- snippet: no-compile (API signature reference, not runnable code) -->

```ts
class PageFactory {
  constructor(page: Page, context?: AuroraFlowContext);
  getPage<T extends PageObjectBase>(pageClass: PageObjectConstructor<T>): T;
  registerPageProvider<T extends PageObjectBase>(
    pageClass: PageObjectConstructor<T>,
    provider: PageObjectProvider<T>,
  ): this;
}
```

`PageFactory` creates and caches one instance per page-object constructor for the active Playwright `Page`. The stable `getPage()` path calls page-object constructors with the `Page` only; any second constructor argument remains page-object/domain owned. `registerPageProvider()` is the experimental opt-in seam for constructors that need the factory-owned `AuroraFlowContext` or additional domain arguments.

## Helpers

### `wait(ms, logger?)`

Waits for `0..60000` milliseconds. Invalid values throw `RangeError`. Pass `null` as the logger to disable wait logging.

### `retry(options)`

Retries an async function with bounded exponential backoff.

<!-- snippet: context
import { retry } from 'auroraflow';
declare function fetchValue(): Promise<string>;
-->

```ts
const value = await retry({
  fn: () => fetchValue(),
  retries: 3,
  initialDelay: 300,
  backoffFactor: 2,
  maxDelay: 30_000,
  jitterRatio: 0.2,
  random: Math.random,
  logger: null,
});
```

Bounds:

- `retries`: integer `1..20`
- `initialDelay`: integer `0..60000`
- `backoffFactor`: finite number `1..10`
- `maxDelay`: integer `0..60000`
- `jitterRatio`: finite number `0..1`
- `random`: returns a finite number `0..1`

After the final failure, `retry()` throws an `Error` describing the exhausted retry count and last error when available.

## Redis and selector registry

### `RedisClient`

`RedisClient` wraps the `redis` driver with validated runtime config, key prefixing, explicit connection lifecycle, bounded retry, SCAN-based discovery, TTL writes, batched reads, and JSON compare-and-set helpers.

Common methods:

<!-- snippet: context
import type { RedisClient } from 'auroraflow';
declare const client: RedisClient;
-->

```ts
await client.connect();
await client.ping();
await client.set('key', 'value', { ttlSeconds: 60 });
const value = await client.get('key');
await client.disconnect();
```

Errors:

- `RedisConfigError`
- `RedisConnectionError`
- `RedisOperationError`

### `SelectorRegistryRepository`

Typed active selector registry over a `SelectorStore`.

```ts
interface SelectorUpsertInput {
  id: string;
  pageObjectName: string;
  actionType: string;
  locator: string;
  strategy?: string;
  confidence?: number;
  notes?: string;
}

interface SelectorRecord extends SelectorUpsertInput {
  schemaVersion: '1.0.0';
  updatedAt: string;
  version: number;
}
```

Useful methods:

- `upsert(input, { expectedVersion? })`
- `get(id)`
- `listAll()`
- `listByPageObject(pageObjectName)`
- `listByPageObjectAndAction(pageObjectName, actionType, limit?)`
- `delete(id)`

Expected-version writes protect reviewed promotion workflows from silent overwrites. Stale selector writes throw `SelectorRegistryConflictError`; stale promotion-status transitions throw `PromotionStatusConflictError`.

Current writes emit `schemaVersion: '1.0.0'`. Reads upgrade legacy unversioned records in memory and hard-reject unknown future versions. `npm run self-heal:repair` audits persistent schema/index drift in dry-run mode; pass `-- --apply` only after review and backup.

Use `createRedisSelectorStore(getRedisClient())` to back the repository with Redis. Use `createMemorySelectorStore()` for a non-durable, process-local store suitable for unit tests, local experiments, and fixture-scoped selector state.

Redis operations, durability, backups, capacity, retention, and incidents are consumer/operator-owned. `AURORAFLOW_REDIS_KEY_PREFIX` is namespace hygiene for qualified keys and scans; it is not authorization. See the [Redis production runbook](./operations/redis-production-runbook.md) before using Redis as shared or durable selector storage.

### `MemorySelectorStore`

<!-- snippet: context
import { createMemorySelectorStore } from 'auroraflow';
-->

```ts
const store = createMemorySelectorStore();

await store.set('selector-registry:login.submit', '{"version":1}');
await store.get('selector-registry:login.submit');
store.clear();
await store.close();
```

`MemorySelectorStore` implements the same `SelectorStore` capabilities as the Redis adapter for common registry paths: `get`, `getMany`, `set`, `del`, `keys`, `scanKeys`, `compareAndSet`, `compareAndSetJsonField`, and `atomicJsonMerge`. It exposes `durability: 'non-durable'`, `clear()`, and idempotent `close()`. It is not shared across processes and must not be used as durable CI or team storage.

## Package lifecycle

The lifecycle contract is implemented. See [Lifecycle contract](./operations/lifecycle.md).

Current APIs remain explicit:

- call `shutdownTelemetry()` when telemetry export/flush matters;
- call `RedisClient.disconnect()` for consumer-created Redis clients;
- create a fresh `PageFactory(page)` for each Playwright `Page`.

The `closeAuroraFlow(context?)` helper is additive, idempotent, safe when optional subsystems are disabled, and never closes Playwright `Page`, `BrowserContext`, or `Browser` objects. The `auroraflow/playwright` fixture keeps the stable `new PageFactory(page)` constructor intact and closes its context after each test.

## Self-healing

Key public functions and types:

- `resolveSelfHealingConfig(env)`
- `analyzeSelfHealingFailure(input)`
- `captureFailureEvent(input)`
- `evaluateGuardedSuggestionsDryRun(input)`
- `rankSelfHealingCandidates(input)`
- `createStoreSelfHealingRegistryRuntime(options)`
- `createRedisSelfHealingRegistryRuntime(options)`
- `resolveSelfHealingRegistryRuntime(env, config, options?)`
- `SelfHealingPromotionWorkflow`

Current lifecycle:

1. Page action fails inside `PageObjectBase`.
2. `suggest` or `guarded` mode captures a failure artifact.
3. SAT can enrich artifacts with bounded DOM evidence, registry candidates, and candidate history.
4. Guarded mode dry-runs ranked candidates and can retry supported actions once.
5. `write_pending` mode can write SAT history and pending promotion records.
6. Reviewed promotion workflow can approve, reject, mark conflicts, or roll back selector registry records with authorization policy and expected-status CAS.

Promotion scope is registry mutation only. AuroraFlow does not rewrite source files or apply blind autonomous selector changes. Local promotion authorization is permissive with a warning. Shared promotion authorization requires CODEOWNERS and protected-workflow evidence before mutating selector records.

### Promotion workflow

<!-- snippet: context
import { createMemorySelectorStore, SelfHealingPromotionWorkflow } from 'auroraflow';
const store = createMemorySelectorStore();
-->

```ts
const workflow = new SelfHealingPromotionWorkflow({ store });

await workflow.list({ selectorId: 'login.submit', limit: 50 });
await workflow.approve({ promotionId: '...', reviewer: 'qa-owner' });
await workflow.reject({ eventId: '...', reviewer: 'qa-owner', reason: 'Wrong target' });
await workflow.rollback({ promotionId: '...', reviewer: 'qa-owner' });
```

The repository script equivalent is:

```bash
npm run self-heal:promotions -- list --selector-id login.submit
npm run self-heal:promotions -- approve --promotion-id <id> --reviewer qa-owner
npm run self-heal:promotions -- reject --promotion-id <id> --reviewer qa-owner --reason "Wrong target"
npm run self-heal:promotions -- rollback --promotion-id <id> --reviewer qa-owner
npm run self-heal:promotions -- cleanup
```

Promotion cleanup is a dry-run by default. Pass `--apply` only after reviewing the summary. For shared registry mutation, run commands with `--authorization-mode shared` and protected workflow evidence.

## Observability

Telemetry is no-op by default.

Key public functions:

- `initializeTelemetry(options?)`
- `getTelemetry()`
- `shutdownTelemetry()`
- `resolveTelemetryConfig(env?)`
- metric and span attribute builders from `framework/observability/attributes`
- `METRIC_NAMES` and `REQUIRED_METRIC_NAMES`

Report APIs:

- `buildFlakinessSummary()`
- `buildFlakinessMarkdown()`
- `buildSloDashboard()`
- `buildSloDashboardMarkdown()`
- `parseAlertPolicy()`
- `evaluateAlertPolicy()`
- `buildAlertEvaluationMarkdown()`
- trend helpers such as `appendObservabilityTrendPoint()` and `readObservabilityTrendPoints()`

Artifact privacy APIs:

- `resolveArtifactPrivacyPolicy()`
- `captureFailureScreenshot()`
- `applyDomSnapshotPrivacy()`
- `DEFAULT_ARTIFACT_PRIVACY_POLICY` and `SENSITIVE_ARTIFACT_PRIVACY_POLICY`

The compatible preset preserves current capture behavior. The sensitive preset disables failure screenshots and omits visible DOM text before self-healing candidate extraction. See [Artifact privacy and retention](./operations/privacy-retention.md).

Live OpenTelemetry export requires `AURORAFLOW_OBSERVABILITY_ENABLED=true` and an OTLP endpoint. JSON/Markdown artifacts remain deterministic evidence even when live telemetry is disabled.

## Artifact schemas

Runtime parsers validate generated artifacts:

- `parseCapturedFailureEvent()`
- `parseDomSnapshot()`
- `parsePendingSelectorPromotion()`
- `parseSelectorCandidateHistory()`

Schema files are shipped under `schemas/` and described in [Artifact schemas](./operations/artifact-schemas.md).
