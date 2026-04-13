import { ElementHandle, Page, Response } from 'playwright';
import { Logger, createChildLogger } from '../utils/logger';
import { resolveSelfHealingConfig } from '../framework/selfHealing/config';
import { captureFailureEvent } from '../framework/selfHealing/failureCapture';
import { SelfHealingActionType } from '../framework/selfHealing/types';

interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

interface ActionOptions {
  timeout?: number;
}

interface ActionContext {
  type: SelfHealingActionType;
  target?: string;
}

// Custom Error for Page Actions
class PageActionError extends Error {
  constructor(
    message: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = 'PageActionError';
  }
}

// Abstract class for Page Objects
export abstract class PageObjectBase {
  protected page: Page;
  protected logger: Logger;
  protected url: string;
  protected pageObjectName: string;

  constructor(page: Page, pageObjectName: string = new.target.name) {
    this.page = page;
    this.pageObjectName = pageObjectName;
    this.logger = createChildLogger(pageObjectName);
    this.url = '#';
    void this.initialize();
  }

  // Asynchronous initialization pattern
  protected async initialize(): Promise<void> {
    // Initialization logic for subclasses, like waiting for specific elements
  }

  // Wrapped actions with custom error handling
  protected async safeAction<T>(
    action: () => Promise<T>,
    successMessage: string,
    errorMessage: string,
    actionContext: ActionContext = { type: 'unknown' },
  ): Promise<T> {
    try {
      const result = await action();
      this.logger.info(successMessage, { result });
      return result;
    } catch (error) {
      this.logger.error(errorMessage, { error });
      const screenshotPath = this.buildFailureScreenshotPath(errorMessage);

      // Take a screenshot on error
      await this.page
        .screenshot({
          path: screenshotPath,
        })
        .catch((screenshotError) =>
          this.logger.error('Failed to take a screenshot.', { screenshotError }),
        );

      await captureFailureEvent({
        config: resolveSelfHealingConfig(process.env),
        pageObjectName: this.pageObjectName,
        currentUrl: this.resolveCurrentUrl(),
        screenshotPath,
        action: {
          type: actionContext.type,
          target: actionContext.target,
          description: errorMessage,
        },
        error,
      }).catch((captureError) =>
        this.logger.error('Failed to capture self-healing failure artifact.', { captureError }),
      );

      throw new PageActionError(
        `${errorMessage}: ${error instanceof Error ? error.message : 'Unknown Error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private buildFailureScreenshotPath(errorMessage: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedMessage = errorMessage.replace(/[^a-z0-9]/gi, '_');
    return `test-results/screenshots/${timestamp}_${sanitizedMessage}.png`;
  }

  private resolveCurrentUrl(): string | undefined {
    try {
      return this.page.url();
    } catch {
      return undefined;
    }
  }

  // Navigation method utilizing safeAction for error handling
  public async navigateTo(
    url: string,
    options: NavigationOptions = { waitUntil: 'domcontentloaded' },
  ): Promise<Response> {
    return this.safeAction(
      async () => {
        const response: Response | null = await this.page.goto(url, options);
        if (!response || !response.ok()) {
          throw new Error(`Navigation to ${url} failed with status: ${response?.status()}`);
        }
        return response;
      },
      `Navigated to ${url}`,
      `Error navigating to ${url}`,
      { type: 'navigate', target: url },
    );
  }

  public async open(): Promise<void> {
    await this.navigateTo(this.url);
  }

  public async getTitle(): Promise<string> {
    return this.page.title();
  }

  public async click(selector: string, options: ActionOptions = {}): Promise<void | null> {
    return this.safeAction(
      () => this.page.click(selector, options),
      `Clicked on selector: ${selector}`,
      `Error clicking on selector ${selector}`,
      { type: 'click', target: selector },
    );
  }

  protected async clickWhenVisible(selector: string, options: ActionOptions = {}): Promise<void> {
    await this.page.waitForSelector(selector, { state: 'visible', ...options });
    await this.page.click(selector, options);
    this.logger.info(`Clicked on visible selector: ${selector}`);
  }

  public async type(
    selector: string,
    text: string,
    options: ActionOptions = {},
  ): Promise<void | null> {
    return this.safeAction(
      () => this.page.fill(selector, text, options),
      `Typed text in selector: ${selector}`,
      `Error typing in selector ${selector}`,
      { type: 'type', target: selector },
    );
  }

  public async getText(selector: string, options: ActionOptions = {}): Promise<string | null> {
    return this.safeAction(
      () => this.page.textContent(selector, options),
      `Retrieved text from selector: ${selector}`,
      `Error retrieving text from selector ${selector}`,
      { type: 'read', target: selector },
    );
  }

  public async waitForSelector(
    selector: string,
    options: ActionOptions = {},
  ): Promise<ElementHandle<unknown> | null> {
    return this.safeAction(
      () => this.page.waitForSelector(selector, options),
      `Waited for selector: ${selector}`,
      `Error waiting for selector ${selector}`,
      { type: 'wait', target: selector },
    );
  }

  public async waitForTimeout(timeout: number): Promise<this> {
    await this.page.waitForTimeout(timeout);
    this.logger.info(`Waited for timeout: ${timeout}ms`);
    return this;
  }

  public async takeScreenshot(path: string): Promise<Buffer> {
    return this.safeAction(
      () => this.page.screenshot({ path }),
      'Screenshot taken',
      'Error taking screenshot',
      { type: 'screenshot', target: path },
    );
  }

  public async close(): Promise<void | null> {
    return this.safeAction(() => this.page.close(), 'Page closed', 'Error closing page', {
      type: 'close',
    });
  }
}
