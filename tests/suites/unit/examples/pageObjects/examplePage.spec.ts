import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamplePage } from '../../../../../examples/demo/pageObjects/ExamplePage';

type LocatorMock = {
  allTextContents: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
};

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
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
    allTextContents: vi.fn().mockResolvedValue(['Our Brands', 'Featured in the News', 'Careers']),
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
    if (selector === 'nav[aria-label="Primary"] a') {
      return navigationLocator;
    }
    if (selector === '[data-testid="hero-video"]') {
      return heroLocator;
    }
    if (selector === '#news-heading') {
      return featuredLocator;
    }
    throw new Error(`Unexpected selector requested in test: ${selector}`);
  });

  return {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Example'),
    textContent: vi.fn().mockResolvedValue('Team CTA selected.'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    close: vi.fn().mockResolvedValue(undefined),
    locator,
  };
}

describe('ExamplePage demo', () => {
  let pageMock: PageMock;
  let examplePage: ExamplePage;

  beforeEach(() => {
    pageMock = createPageMock();
    examplePage = new ExamplePage(pageMock as unknown as Page, 'file:///example-app.html');
  });

  it('opens the deterministic fixture URL', async () => {
    await examplePage.open();

    expect(pageMock.goto).toHaveBeenCalledWith('file:///example-app.html', {
      waitUntil: 'domcontentloaded',
    });
  });

  it('navigates to a section through the safe click wrapper', async () => {
    await examplePage.navigateToSection('Our Brands');

    expect(pageMock.click).toHaveBeenCalledWith('text=Our Brands', {});
  });

  it('clicks Join Our Team through the safe click wrapper', async () => {
    await examplePage.clickOnJoinOurTeam();

    expect(pageMock.click).toHaveBeenCalledWith('#join-team', {});
  });

  it('returns deterministic fixture content through safeAction', async () => {
    await expect(examplePage.getNavigationMenuLinksTexts()).resolves.toEqual([
      'Our Brands',
      'Featured in the News',
      'Careers',
    ]);
    await expect(examplePage.isHeroVideoPresent()).resolves.toBe(true);
    await expect(examplePage.isFeaturedNewsPresent()).resolves.toBe(true);
    await expect(examplePage.callToActionStatusText()).resolves.toBe('Team CTA selected.');
  });
});
