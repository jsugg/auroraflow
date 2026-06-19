import type { Page } from 'playwright';
import type { Logger } from '../utils/logger';
import { PageObjectBase } from '../pageObjects/pageObjectBase';
import {
  createAuroraFlowContext,
  type AuroraFlowContext,
} from '../framework/runtime/auroraFlowContext';

export type PageObjectConstructor<T extends PageObjectBase = PageObjectBase> = new (
  page: Page,
) => T;

export type PageObjectProvider<T extends PageObjectBase = PageObjectBase> = (
  page: Page,
  context: AuroraFlowContext,
) => T;

export class PageFactory {
  private readonly page: Page;
  private readonly context: AuroraFlowContext;
  private readonly logger: Logger;
  private readonly pageInstances = new Map<PageObjectConstructor, PageObjectBase>();
  private readonly pageProviders = new Map<PageObjectConstructor, PageObjectProvider>();

  /**
   * Constructor for the PageFactory class.
   *
   * @param {Page} page - The page parameter
   * @param {AuroraFlowContext} context - Runtime dependencies made available to
   *   registered page providers. Defaults to the env-backed context.
   */
  constructor(page: Page, context: AuroraFlowContext = createAuroraFlowContext()) {
    this.page = page;
    this.context = context;
    this.logger = context.createLogger('PageFactory');
  }

  /**
   * Registers an explicit page-object provider for constructor shapes that need
   * factory-owned dependencies or additional domain arguments.
   *
   * @param {PageObjectConstructor<T>} pageClass - The page object cache key.
   * @param {PageObjectProvider<T>} provider - Factory invoked with the Playwright page and runtime context.
   * @return {PageFactory} This factory for fluent setup.
   */
  registerPageProvider<T extends PageObjectBase>(
    pageClass: PageObjectConstructor<T>,
    provider: PageObjectProvider<T>,
  ): this {
    this.pageProviders.set(pageClass, provider);
    this.pageInstances.delete(pageClass);
    return this;
  }

  /**
   * Retrieves or creates an instance of the specified page class and returns it.
   *
   * @param {PageObjectConstructor<T>} pageClass - The page object constructor to retrieve or create.
   * @return {T} The instance of the specified page class.
   */
  getPage<T extends PageObjectBase>(pageClass: PageObjectConstructor<T>): T {
    const className = pageClass.name;
    if (!this.pageInstances.has(pageClass)) {
      const pageInstance = this.createPage(pageClass);
      this.pageInstances.set(pageClass, pageInstance);
      this.logger.info(`Created new instance of ${className}`);
    }
    return this.pageInstances.get(pageClass) as T;
  }

  private createPage<T extends PageObjectBase>(pageClass: PageObjectConstructor<T>): T {
    const provider = this.pageProviders.get(pageClass) as PageObjectProvider<T> | undefined;
    return provider ? provider(this.page, this.context) : new pageClass(this.page);
  }
}
