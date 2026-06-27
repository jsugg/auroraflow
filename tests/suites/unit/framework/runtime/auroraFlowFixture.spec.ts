import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageFactory } from '../../../../../src/helpers/pageFactory';
import {
  withAuroraFlowFixture,
  type AuroraFlowFixture,
} from '../../../../../src/framework/runtime/auroraFlowFixture';
import {
  isAuroraFlowContextClosed,
  registerAuroraFlowDisposer,
  resetDefaultAuroraFlowContextForTests,
} from '../../../../../src/framework/runtime/lifecycle';

afterEach(() => {
  resetDefaultAuroraFlowContextForTests();
});

function createFakePage(): {
  page: Page;
  pageClose: ReturnType<typeof vi.fn>;
  browserContextClose: ReturnType<typeof vi.fn>;
} {
  const pageClose = vi.fn();
  const browserContextClose = vi.fn();
  const page = {
    close: pageClose,
    context: vi.fn(() => ({ close: browserContextClose })),
  };
  return { page: page as unknown as Page, pageClose, browserContextClose };
}

describe('withAuroraFlowFixture (auroraflow/playwright lifecycle)', () => {
  it('provides a test-scoped context and page factory, then closes the context after the test', async () => {
    const { page } = createFakePage();
    const subsystemDispose = vi.fn();
    let captured: AuroraFlowFixture | undefined;

    await withAuroraFlowFixture(page, {}, async (fixture) => {
      captured = fixture;
      // A subsystem registers owned cleanup against the test-scoped context.
      registerAuroraFlowDisposer(fixture.context, subsystemDispose, 'telemetry');
      expect(isAuroraFlowContextClosed(fixture.context)).toBe(false);
    });

    expect(captured?.page).toBe(page);
    expect(captured?.pages).toBeInstanceOf(PageFactory);
    expect(subsystemDispose).toHaveBeenCalledTimes(1);
    expect(captured ? isAuroraFlowContextClosed(captured.context) : false).toBe(true);
  });

  it('never closes the consumer-owned Playwright page or browser context', async () => {
    const { page, pageClose, browserContextClose } = createFakePage();

    await withAuroraFlowFixture(page, {}, async () => {
      // no-op test body
    });

    expect(pageClose).not.toHaveBeenCalled();
    expect(browserContextClose).not.toHaveBeenCalled();
  });

  it('still closes the context when the test body throws', async () => {
    const { page } = createFakePage();
    const subsystemDispose = vi.fn();
    let leakedContext: AuroraFlowFixture['context'] | undefined;

    await expect(
      withAuroraFlowFixture(page, {}, async (fixture) => {
        leakedContext = fixture.context;
        registerAuroraFlowDisposer(fixture.context, subsystemDispose, 'telemetry');
        throw new Error('test failed');
      }),
    ).rejects.toThrow('test failed');

    expect(subsystemDispose).toHaveBeenCalledTimes(1);
    expect(leakedContext ? isAuroraFlowContextClosed(leakedContext) : false).toBe(true);
  });
});
