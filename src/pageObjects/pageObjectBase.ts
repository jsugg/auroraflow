import { ElementHandle, Page, Response } from 'playwright';
import { Logger, createChildLogger } from '../utils/logger';
import { resolveSelfHealingConfig } from '../framework/selfHealing/config';
import { captureFailureEvent } from '../framework/selfHealing/failureCapture';
import { generateRankedLocatorSuggestions } from '../framework/selfHealing/suggestionEngine';
import {
  evaluateGuardedSuggestionsDryRun,
  resolveLocatorExpression,
} from '../framework/selfHealing/guardedValidation';
import { GuardedAutoHealSummary, SelfHealingActionType } from '../framework/selfHealing/types';

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

type GuardedAutoHealAction<T> = (acceptedLocator: string) => Promise<T>;

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
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(page: Page, pageObjectName: string = new.target.name) {
    this.page = page;
    this.pageObjectName = pageObjectName;
    this.logger = createChildLogger(pageObjectName);
    this.url = '#';
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
    guardedAutoHealAction?: GuardedAutoHealAction<T>,
    requiresInitialization: boolean = true,
  ): Promise<T> {
    try {
      if (requiresInitialization) {
        await this.ensureInitialized();
      }
      const result = await action();
      this.logger.info(successMessage, { result });
      return result;
    } catch (error) {
      this.logger.error(errorMessage, { error });
      const screenshotPath = this.buildFailureScreenshotPath(errorMessage);
      const currentUrl = this.resolveCurrentUrl();

      // Take a screenshot on error
      await this.page
        .screenshot({
          path: screenshotPath,
        })
        .catch((screenshotError) =>
          this.logger.error('Failed to take a screenshot.', { screenshotError }),
        );

      const selfHealingConfig = resolveSelfHealingConfig(process.env);
      const rankedSuggestions = generateRankedLocatorSuggestions({
        actionType: actionContext.type,
        failedTarget: actionContext.target,
      });
      let guardedValidation:
        | Awaited<ReturnType<typeof evaluateGuardedSuggestionsDryRun>>
        | undefined;
      let guardedAutoHeal: GuardedAutoHealSummary | undefined;
      let guardedAutoHealResult: T | undefined;

      if (selfHealingConfig.mode === 'guarded') {
        guardedValidation = await evaluateGuardedSuggestionsDryRun({
          page: this.page,
          actionType: actionContext.type,
          minConfidence: selfHealingConfig.minConfidence,
          suggestions: rankedSuggestions,
          currentUrl,
          safetyPolicy: selfHealingConfig.safetyPolicy,
        });

        if (guardedValidation.acceptedLocator && guardedAutoHealAction) {
          guardedAutoHeal = {
            attempted: true,
            succeeded: false,
            locator: guardedValidation.acceptedLocator,
          };

          try {
            guardedAutoHealResult = await guardedAutoHealAction(guardedValidation.acceptedLocator);
            guardedAutoHeal.succeeded = true;
            this.logger.warn('Guarded auto-heal apply succeeded.', {
              actionType: actionContext.type,
              acceptedLocator: guardedValidation.acceptedLocator,
            });
          } catch (guardedAutoHealError: unknown) {
            guardedAutoHeal.errorMessage =
              guardedAutoHealError instanceof Error
                ? guardedAutoHealError.message
                : 'Unknown guarded auto-heal apply error.';
            this.logger.error('Guarded auto-heal apply failed.', {
              guardedAutoHealError,
              actionType: actionContext.type,
              acceptedLocator: guardedValidation.acceptedLocator,
            });
          }
        } else if (guardedValidation.acceptedLocator) {
          guardedAutoHeal = {
            attempted: false,
            succeeded: false,
            locator: guardedValidation.acceptedLocator,
            skippedReason: 'unsupported_action',
          };
        } else if (guardedAutoHealAction) {
          guardedAutoHeal = {
            attempted: false,
            succeeded: false,
            skippedReason: 'no_accepted_locator',
          };
        }
      }

      await captureFailureEvent({
        config: selfHealingConfig,
        pageObjectName: this.pageObjectName,
        currentUrl,
        screenshotPath,
        action: {
          type: actionContext.type,
          target: actionContext.target,
          description: errorMessage,
        },
        error,
        decorateEvent: async (event) => {
          if (guardedValidation) {
            event.guardedValidation = guardedValidation;
          }
          if (guardedAutoHeal) {
            event.guardedAutoHeal = guardedAutoHeal;
          }
        },
      }).catch((captureError) =>
        this.logger.error('Failed to capture self-healing failure artifact.', { captureError }),
      );

      if (guardedAutoHeal?.attempted && guardedAutoHeal.succeeded) {
        return guardedAutoHealResult as T;
      }

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

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = (async () => {
        await this.initialize();
        this.initialized = true;
      })().finally(() => {
        this.initializationPromise = null;
      });
    }

    await this.initializationPromise;
  }

  private resolveCurrentUrl(): string | undefined {
    try {
      return this.page.url();
    } catch {
      return undefined;
    }
  }

  private resolveGuardedLocator(locatorExpression: string) {
    const locator = resolveLocatorExpression(this.page, locatorExpression);
    if (!locator) {
      throw new Error(`Unsupported guarded locator expression: ${locatorExpression}`);
    }
    return locator;
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
      undefined,
      false,
    );
  }

  public async open(): Promise<void> {
    await this.navigateTo(this.url);
    await this.ensureInitialized();
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
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator);
        await locator.first().click(options);
        return null;
      },
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
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator);
        await locator.first().fill(text, options);
        return null;
      },
    );
  }

  public async getText(selector: string, options: ActionOptions = {}): Promise<string | null> {
    return this.safeAction(
      () => this.page.textContent(selector, options),
      `Retrieved text from selector: ${selector}`,
      `Error retrieving text from selector ${selector}`,
      { type: 'read', target: selector },
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator);
        return locator.first().textContent(options);
      },
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
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator).first();
        await locator.waitFor({ state: 'attached', timeout: options.timeout });
        return locator.elementHandle();
      },
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
    return this.safeAction(
      () => this.page.close(),
      'Page closed',
      'Error closing page',
      {
        type: 'close',
      },
      undefined,
      false,
    );
  }
}
