import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExamplePage from '../../../../../src/pageObjects/examplePage';

type LocatorMock = {
  allTextContents: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
};

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  waitForLoadState: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  textContent: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
};

function createPageMock(): PageMock {
  const navigationLocator: LocatorMock = {
    allTextContents: vi.fn().mockResolvedValue(['Our Brands', 'About']),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const heroLocator: LocatorMock = {
    allTextContents: vi.fn().mockResolvedValue([]),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const featuredLocator: LocatorMock = {
    allTextContents: vi.fn().mockResolvedValue([]),
    isVisible: vi.fn().mockResolvedValue(true),
  };

  const locator = vi.fn((selector: string) => {
    if (selector === '.hhs-nav-grid__menu >> a') {
      return navigationLocator;
    }
    if (selector === '.hhs-hero-mod video') {
      return heroLocator;
    }
    if (selector === 'text=Featured in the News') {
      return featuredLocator;
    }
    throw new Error(`Unexpected selector requested in test: ${selector}`);
  });

  return {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Example'),
    textContent: vi.fn().mockResolvedValue('text'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    close: vi.fn().mockResolvedValue(undefined),
    locator,
  };
}

describe('ExamplePage', () => {
  let pageMock: PageMock;
  let examplePage: ExamplePage;

  beforeEach(() => {
    pageMock = createPageMock();
    examplePage = new ExamplePage(pageMock as unknown as Page);
  });

  it('navigates to a section through the safe click wrapper and waits for network idle', async () => {
    await examplePage.navigateToSection('Our Brands');

    expect(pageMock.click).toHaveBeenCalledWith('text=Our Brands', {});
    expect(pageMock.waitForLoadState).toHaveBeenCalledWith('networkidle');
  });

  it('clicks Join Our Team through the safe click wrapper', async () => {
    await examplePage.clickOnJoinOurTeam();

    expect(pageMock.click).toHaveBeenCalledWith('text=Join Our Team', {});
  });

  it('returns navigation menu link text values through safeAction', async () => {
    await expect(examplePage.getNavigationMenuLinksTexts()).resolves.toEqual([
      'Our Brands',
      'About',
    ]);
  });
});
