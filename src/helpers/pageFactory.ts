import { Page } from 'playwright';
import { Logger, createChildLogger } from '../utils/logger';
import { PageObjectBase } from '../../pageObjects/pageObjectBase';

export class PageFactory {
  private page: Page;
  private logger: Logger;
  private pageInstances = new Map<string, PageObjectBase>();

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
   * @param {new (page: Page) => T} pageClass - The class of the page to retrieve or create an instance of.
   * @return {T} The instance of the specified page class.
   */
  getPage<T extends PageObjectBase>(pageClass: new (page: Page) => T): T {
    const className = pageClass.name;
    if (!this.pageInstances.has(className)) {
      const pageInstance = new pageClass(this.page);
      this.pageInstances.set(className, pageInstance);
      this.logger.info(`Created new instance of ${className}`);
    }
    return this.pageInstances.get(className) as T;
  }
}
