import type { Page } from 'playwright';
import { Logger, createChildLogger } from '../utils/logger';
import { PageObjectBase } from '../pageObjects/pageObjectBase';

export type PageObjectConstructor<T extends PageObjectBase = PageObjectBase> = new (
  page: Page,
) => T;

export class PageFactory {
  private page: Page;
  private logger: Logger;
  private pageInstances = new Map<PageObjectConstructor, PageObjectBase>();

  /**
   * Constructor for the PageFactory class.
   *
   * @param {Page} page - The page parameter
   */
  constructor(page: Page) {
    this.page = page;
    this.logger = createChildLogger('PageFactory');
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
      const pageInstance = new pageClass(this.page);
      this.pageInstances.set(pageClass, pageInstance);
      this.logger.info(`Created new instance of ${className}`);
    }
    return this.pageInstances.get(pageClass) as T;
  }
}
