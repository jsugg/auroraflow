# Lifecycle contract

This document records the AuroraFlow lifecycle contract. The disposer registry, `closeAuroraFlow(context?)`, and the `auroraflow/playwright` fixture have shipped. Consumers may still call the existing subsystem APIs directly, such as `shutdownTelemetry()` and `RedisClient.disconnect()`.

## `closeAuroraFlow(context?)`

`closeAuroraFlow(context?)` is an additive package helper. It does not remove or weaken existing subsystem shutdown APIs.

Guaranteed semantics:

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

The default context keeps current behavior: environment-backed logger, telemetry, Redis, self-healing config, artifact privacy, and registry runtime. Injected contexts own only the resources they create. Register owned cleanup with `registerAuroraFlowDisposer(context, disposer)`; a context with no registered disposers closes as a no-op, which keeps cleanup safe when optional subsystems are disabled.

## `auroraflow/playwright` fixture

The `auroraflow/playwright` entrypoint wraps Playwright Test fixtures without changing the stable `new PageFactory(page)` constructor.

Fixture shape:

```ts
import { test, expect } from 'auroraflow/playwright';

test('uses AuroraFlow page objects', async ({ auroraFlow }) => {
  const pageObject = auroraFlow.pages.getPage(MyPage);
  await pageObject.open();
  await expect(auroraFlow.page).toHaveTitle(/Example/);
});
```

Fixture ownership:

- test-scoped AuroraFlow context;
- a `PageFactory` bound to the test's Playwright `Page` and that context;
- fixture cleanup calls `closeAuroraFlow(context)` after each test, even when the test fails;
- Playwright owns the browser/page lifecycle;
- Redis, telemetry, and logger resources are closed only when the AuroraFlow context created them;
- the fixture is safe when Redis and telemetry are disabled.

## Consumer responsibilities

When not using the `auroraflow/playwright` fixture:

- call `shutdownTelemetry()` when telemetry was initialized and final export/flush matters;
- call `RedisClient.disconnect()` for any Redis client created by the consumer;
- create a new `PageFactory(page)` when Playwright creates a new `Page`;
- avoid reusing cached page objects after their underlying Playwright page closes.

The lifecycle helper deliberately avoids process hooks and hidden ownership changes; consumer-owned Playwright and injected clients remain the consumer's responsibility.
