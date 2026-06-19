import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  PageActionError,
  PageFactory,
  PageObjectBase,
  type ActionOptions,
  type NavigationOptions,
  type PageObjectConstructor,
  type PageObjectProvider,
} from '../../../../../src';

class PublicApiPage extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'PublicApiPage');
  }
}

describe('Page Object public API', () => {
  it('exposes PageObjectBase and PageFactory from the public entrypoint', () => {
    const page = {} as Page;
    const pageConstructor: PageObjectConstructor<PublicApiPage> = PublicApiPage;
    const pageProvider: PageObjectProvider<PublicApiPage> = (providedPage) =>
      new PublicApiPage(providedPage);
    const factory = new PageFactory(page);
    factory.registerPageProvider(pageConstructor, pageProvider);

    const pageObject = factory.getPage(pageConstructor);

    expect(pageObject).toBeInstanceOf(PublicApiPage);
    expect(factory.getPage(pageConstructor)).toBe(pageObject);
  });

  it('exposes stable action option and error contracts', () => {
    const navigationOptions: NavigationOptions = {
      waitUntil: 'domcontentloaded',
      timeout: 1_000,
    };
    const actionOptions: ActionOptions = {
      timeout: 500,
    };
    const originalError = new Error('root cause');
    const pageError = new PageActionError('action failed', originalError);

    expect(navigationOptions.timeout).toBe(1_000);
    expect(actionOptions.timeout).toBe(500);
    expect(pageError.name).toBe('PageActionError');
    expect(pageError.originalError).toBe(originalError);
  });
});
