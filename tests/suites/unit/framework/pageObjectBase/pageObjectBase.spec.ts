import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';

class TestPageObject extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'TestPageObject');
  }
}

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  textContent: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
};

function createPageMock(): PageMock {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    textContent: vi.fn().mockResolvedValue('text'),
    title: vi.fn().mockResolvedValue('title'),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PageObjectBase error propagation', () => {
  let pageMock: PageMock;
  let pageObject: TestPageObject;

  beforeEach(() => {
    pageMock = createPageMock();
    pageObject = new TestPageObject(pageMock as unknown as Page);
  });

  it('propagates fill failures from type() and captures a screenshot', async () => {
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#username', 'alice')).rejects.toThrow(
      'Error typing in selector #username: fill failed',
    );

    expect(pageMock.screenshot).toHaveBeenCalledTimes(1);
    const screenshotArg = pageMock.screenshot.mock.calls[0][0] as { path: string };
    expect(screenshotArg.path).toMatch(/^test-results\/screenshots\//);
    expect(screenshotArg.path).not.toContain(':');
  });

  it('propagates close() failures and captures a screenshot', async () => {
    pageMock.close.mockRejectedValueOnce(new Error('close failed'));

    await expect(pageObject.close()).rejects.toThrow('Error closing page: close failed');

    expect(pageMock.screenshot).toHaveBeenCalledTimes(1);
  });
});
