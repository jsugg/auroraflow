import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { PageFactory } from '../../../../../src/helpers/pageFactory';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';

class ExampleFactoryPage extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'ExampleFactoryPage');
  }
}

const DuplicateFactoryPageA = class DuplicateFactoryPage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
  }
};

const DuplicateFactoryPageB = class DuplicateFactoryPage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
  }
};

describe('PageFactory', () => {
  it('returns a singleton instance per page-object constructor', () => {
    const factory = new PageFactory({} as Page);

    const first = factory.getPage(ExampleFactoryPage);
    const second = factory.getPage(ExampleFactoryPage);

    expect(second).toBe(first);
  });

  it('does not collide cache entries when constructors share the same class name', () => {
    const factory = new PageFactory({} as Page);

    const first = factory.getPage(DuplicateFactoryPageA);
    const second = factory.getPage(DuplicateFactoryPageB);

    expect(first).toBeInstanceOf(DuplicateFactoryPageA);
    expect(second).toBeInstanceOf(DuplicateFactoryPageB);
    expect(second).not.toBe(first);
    expect(factory.getPage(DuplicateFactoryPageA)).toBe(first);
    expect(factory.getPage(DuplicateFactoryPageB)).toBe(second);
  });
});
