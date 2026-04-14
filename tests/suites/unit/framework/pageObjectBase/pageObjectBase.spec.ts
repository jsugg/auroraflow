import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';

class TestPageObject extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'TestPageObject');
  }
}

class InitializingPageObject extends PageObjectBase {
  private readonly initializeFn: () => Promise<void>;

  constructor(page: Page, initializeFn: () => Promise<void>) {
    super(page, 'InitializingPageObject');
    this.initializeFn = initializeFn;
  }

  protected override async initialize(): Promise<void> {
    await this.initializeFn();
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

function createDeferred<TValue>(): {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: TValue) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

  it('waits for initialization completion before executing page actions', async () => {
    const deferred = createDeferred<void>();
    const initializeFn = vi.fn(() => deferred.promise);
    const initializingPageObject = new InitializingPageObject(
      pageMock as unknown as Page,
      initializeFn,
    );

    const typePromise = initializingPageObject.type('#username', 'alice');
    await Promise.resolve();

    expect(pageMock.fill).not.toHaveBeenCalled();
    deferred.resolve(undefined);

    await expect(typePromise).resolves.toBeUndefined();
    expect(initializeFn).toHaveBeenCalledTimes(1);
    expect(pageMock.fill).toHaveBeenCalledTimes(1);
  });

  it('surfaces initialization failures and skips action execution', async () => {
    const initializeFn = vi.fn(async () => {
      throw new Error('init failed');
    });
    const initializingPageObject = new InitializingPageObject(
      pageMock as unknown as Page,
      initializeFn,
    );

    await expect(initializingPageObject.type('#username', 'alice')).rejects.toThrow(
      'Error typing in selector #username: init failed',
    );

    expect(initializeFn).toHaveBeenCalledTimes(1);
    expect(pageMock.fill).not.toHaveBeenCalled();
  });

  it('runs open() navigation before initialization', async () => {
    const callOrder: string[] = [];
    pageMock.goto.mockImplementation(async () => {
      callOrder.push('goto');
      return { ok: () => true, status: () => 200 };
    });
    const initializeFn = vi.fn(async () => {
      callOrder.push('initialize');
    });
    const initializingPageObject = new InitializingPageObject(
      pageMock as unknown as Page,
      initializeFn,
    );

    await initializingPageObject.open();

    expect(callOrder).toEqual(['goto', 'initialize']);
  });
});
