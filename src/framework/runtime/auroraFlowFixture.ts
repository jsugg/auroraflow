import type { Page } from 'playwright';
import { PageFactory } from '../../helpers/pageFactory';
import {
  createAuroraFlowContext,
  type AuroraFlowContext,
  type AuroraFlowContextOptions,
} from './auroraFlowContext';
import { closeAuroraFlow } from './lifecycle';

/** Test-scoped AuroraFlow runtime bundle exposed by the `auroraflow/playwright` fixture. */
export interface AuroraFlowFixture {
  /** Test-scoped runtime context; closed automatically after the test. */
  readonly context: AuroraFlowContext;
  /** Page factory bound to the test's Playwright page and this context. */
  readonly pages: PageFactory;
  /** The consumer-owned Playwright page; never closed by AuroraFlow. */
  readonly page: Page;
}

/**
 * Drives the AuroraFlow Playwright fixture lifecycle for a single test. Builds a
 * test-scoped context and a {@link PageFactory} bound to it, hands them to `use`,
 * then closes the context in a `finally` so owned disposers run even when the test
 * throws. Playwright owns the browser/page/`BrowserContext` lifecycle, so this
 * helper never closes them. Kept browser-free (no `@playwright/test` import) so the
 * lifecycle boundaries can be proven by fast unit tests.
 */
export async function withAuroraFlowFixture(
  page: Page,
  options: AuroraFlowContextOptions,
  use: (fixture: AuroraFlowFixture) => Promise<void>,
): Promise<void> {
  const context = createAuroraFlowContext(options);
  const pages = new PageFactory(page, context);
  try {
    await use({ context, pages, page });
  } finally {
    await closeAuroraFlow(context);
  }
}
