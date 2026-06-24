import { test as base, expect } from '@playwright/test';
import {
  withAuroraFlowFixture,
  type AuroraFlowFixture,
} from './framework/runtime/auroraFlowFixture';
import type { AuroraFlowContextOptions } from './framework/runtime/auroraFlowContext';

export type { AuroraFlowFixture };
export {
  AuroraFlowCloseError,
  closeAuroraFlow,
  type AuroraFlowDisposer,
  type AuroraFlowDisposerFailure,
} from './framework/runtime/lifecycle';

/** Fixtures contributed by the `auroraflow/playwright` entrypoint. */
export interface AuroraFlowFixtures {
  /** Per-test overrides for the AuroraFlow runtime context. */
  auroraFlowContextOptions: AuroraFlowContextOptions;
  /** Test-scoped AuroraFlow runtime bundle, cleaned up after each test. */
  auroraFlow: AuroraFlowFixture;
}

/**
 * Playwright `test` extended with an `auroraFlow` fixture that provides a
 * test-scoped runtime context and a page factory bound to the test page, then
 * closes the context after each test via {@link closeAuroraFlow}. Wraps Playwright
 * Test without changing the stable `new PageFactory(page)` constructor, and keeps
 * Playwright in charge of the browser/page/`BrowserContext` lifecycle.
 */
export const test = base.extend<AuroraFlowFixtures>({
  auroraFlowContextOptions: [{}, { option: true }],
  auroraFlow: async ({ page, auroraFlowContextOptions }, use) => {
    await withAuroraFlowFixture(page, auroraFlowContextOptions, use);
  },
});

export { expect };
