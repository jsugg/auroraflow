# Lifecycle contract

This document records the Phase 1 contract for AuroraFlow lifecycle management. It is a design contract for `AUR-IMPL-013`; implementation remains a Phase 2 task under `AUR-IMPL-023` after `AuroraFlowContext` exists. Today consumers still call the existing subsystem APIs directly, such as `shutdownTelemetry()` and `RedisClient.disconnect()`.

## Planned `closeAuroraFlow(context?)`

`closeAuroraFlow(context?)` will be an additive package helper. It must not remove or weaken existing subsystem shutdown APIs.

Required semantics:

- one-shot per runtime context;
- concurrent calls for the same context coalesce onto the same close operation;
- owned disposers run at most once;
- disposers run in reverse registration order;
- every registered disposer is attempted even if an earlier disposer fails;
- cleanup failures surface as an aggregate error with per-disposer causes;
- disabled subsystems are no-ops and must not initialize during cleanup;
- Playwright `Page`, `BrowserContext`, and `Browser` objects are never closed by AuroraFlow;
- injected resources remain consumer-owned unless a future API explicitly transfers ownership;
- no process-exit hooks are installed by default.

The default context will keep current behavior: environment-backed logger, telemetry, Redis, self-healing config, artifact privacy, and registry runtime. Future injected contexts may own only the resources they create.

## Planned `auroraflow/playwright` fixture

The future `auroraflow/playwright` entrypoint will wrap Playwright Test fixtures without changing the stable `new PageFactory(page)` constructor.

Target fixture shape:

```ts
import { test, expect } from 'auroraflow/playwright';

test('uses AuroraFlow page objects', async ({ auroraFlow }) => {
  const pageObject = auroraFlow.pages.getPage(MyPage);
  await pageObject.open();
  await expect(auroraFlow.page).toHaveTitle(/Example/);
});
```

Planned fixture ownership:

- test-scoped AuroraFlow context;
- fresh `PageFactory` for each Playwright `Page`/attempt;
- fixture cleanup calls `closeAuroraFlow(context)` after each test;
- Playwright owns browser/page lifecycle;
- Redis, telemetry, and logger resources are closed only when the AuroraFlow context created them;
- fixture must be safe when Redis and telemetry are disabled.

## Current consumer responsibilities

Until `AUR-IMPL-023` lands:

- call `shutdownTelemetry()` when telemetry was initialized and final export/flush matters;
- call `RedisClient.disconnect()` for any Redis client created by the consumer;
- create a new `PageFactory(page)` when Playwright creates a new `Page`;
- avoid reusing cached page objects after their underlying Playwright page closes.

This contract intentionally avoids Phase 2 runtime refactors, process hooks, and hidden ownership changes.
