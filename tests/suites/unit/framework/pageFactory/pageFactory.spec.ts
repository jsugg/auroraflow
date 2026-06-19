import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  createAuroraFlowContext,
  type AuroraFlowContext,
} from '../../../../../src/framework/runtime/auroraFlowContext';
import { PageFactory } from '../../../../../src/helpers/pageFactory';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';

const DEFAULT_FACTORY_PAGE_URL = 'https://example.test/default';
const REGISTERED_FACTORY_PAGE_URL = 'https://example.test/registered';

class ExampleFactoryPage extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'ExampleFactoryPage');
  }
}

class UrlFactoryPage extends PageObjectBase {
  public readonly fixtureUrl: string;

  constructor(page: Page, fixtureUrl: string = DEFAULT_FACTORY_PAGE_URL) {
    super(page, 'UrlFactoryPage');
    this.fixtureUrl = fixtureUrl;
  }
}

class NoConstructorFactoryPage extends PageObjectBase {}

class ContextAwareFactoryPage extends PageObjectBase {
  public readonly fixtureUrl: string;
  public readonly assignedRunId: string;

  constructor(
    page: Page,
    fixtureUrl: string = DEFAULT_FACTORY_PAGE_URL,
    context?: AuroraFlowContext,
  ) {
    super(page, 'ContextAwareFactoryPage', context);
    this.fixtureUrl = fixtureUrl;
    this.assignedRunId = this.runId;
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

  it('creates page objects whose second constructor argument is domain-owned', () => {
    const context = createAuroraFlowContext({
      correlation: { runId: 'runtime-context-is-not-a-url' },
    });
    const factory = new PageFactory({} as Page, context);

    const pageObject = factory.getPage(UrlFactoryPage);

    expect(pageObject.fixtureUrl).toBe(DEFAULT_FACTORY_PAGE_URL);
  });

  it('accepts page-object subclasses without an explicit constructor', () => {
    const factory = new PageFactory({} as Page);

    const pageObject = factory.getPage(NoConstructorFactoryPage);

    expect(pageObject).toBeInstanceOf(NoConstructorFactoryPage);
  });

  it('uses an explicit provider when page creation needs the runtime context', () => {
    const context = createAuroraFlowContext({
      correlation: { runId: 'factory-run', testId: 'factory-test' },
    });
    const factory = new PageFactory({} as Page, context);

    factory.registerPageProvider(
      ContextAwareFactoryPage,
      (page, runtimeContext) =>
        new ContextAwareFactoryPage(page, REGISTERED_FACTORY_PAGE_URL, runtimeContext),
    );

    const pageObject = factory.getPage(ContextAwareFactoryPage);

    expect(pageObject.fixtureUrl).toBe(REGISTERED_FACTORY_PAGE_URL);
    expect(pageObject.assignedRunId).toBe('factory-run');
    expect(factory.getPage(ContextAwareFactoryPage)).toBe(pageObject);
  });

  it('recreates a cached page object when a provider is registered for it', () => {
    const context = createAuroraFlowContext({
      correlation: { runId: 'registered-run' },
    });
    const factory = new PageFactory({} as Page, context);
    const defaultInstance = factory.getPage(ContextAwareFactoryPage);

    factory.registerPageProvider(
      ContextAwareFactoryPage,
      (page, runtimeContext) =>
        new ContextAwareFactoryPage(page, REGISTERED_FACTORY_PAGE_URL, runtimeContext),
    );

    const registeredInstance = factory.getPage(ContextAwareFactoryPage);

    expect(registeredInstance).not.toBe(defaultInstance);
    expect(registeredInstance.fixtureUrl).toBe(REGISTERED_FACTORY_PAGE_URL);
    expect(registeredInstance.assignedRunId).toBe('registered-run');
  });
});
