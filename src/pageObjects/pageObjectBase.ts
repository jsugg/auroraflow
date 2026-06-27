import type { ElementHandle, Page, Response } from 'playwright';
import type { Logger } from '../utils/logger';
import {
  consumeSelfHealingRunBudget,
  createAuroraFlowContext,
  type AuroraFlowContext,
} from '../framework/runtime/auroraFlowContext';
import { analyzeSelfHealingFailure } from '../framework/selfHealing/analyzer';
import {
  captureFailureEvent,
  createFileFailureArtifactWriter,
} from '../framework/selfHealing/failureCapture';
import {
  captureFailureScreenshot,
  type ArtifactPrivacyPolicy,
} from '../framework/selfHealing/artifactPrivacy';
import { persistSelfHealingRegistryTelemetry } from '../framework/selfHealing/registryPersistence';
import { generateRankedLocatorSuggestions } from '../framework/selfHealing/suggestionEngine';
import {
  evaluateGuardedSuggestionsDryRun,
  resolveLocatorExpression,
} from '../framework/selfHealing/guardedValidation';
import type {
  GuardedAutoHealSummary,
  SelfHealingRegistryPersistenceSummary,
  SelfHealingActionType,
  SelfHealingConfig,
} from '../framework/selfHealing/types';
import type { SelfHealingRegistryRuntime } from '../framework/selfHealing/registryContracts';
import {
  SPAN_NAMES,
  buildGuardedAutoHealMetricAttributes,
  buildPageActionMetricAttributes,
  buildPageActionSpanAttributes,
  buildSelfHealingDurationMetricAttributes,
  type GuardedAutoHealMetricStatus,
  type PageActionMetricStatus,
} from '../framework/observability/attributes';
import { METRIC_NAMES } from '../framework/observability/metricNames';
import type { TelemetrySpan } from '../framework/observability/telemetry';
import { PageActionPipeline, type PageActionPipelineExecution } from './pageActionPipeline';

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface ActionContext {
  type: SelfHealingActionType;
  target?: string;
  targetAlias?: string;
  expectedRole?: string;
  expectedName?: string;
  selectorId?: string;
}

export interface ActionOptions extends Omit<ActionContext, 'target' | 'type'> {
  timeout?: number;
}

type GuardedAutoHealAction<T> = (acceptedLocator: string) => Promise<T>;

const MAX_ACTION_TIMEOUT_MS = 120_000;
const MAX_EXPLICIT_WAIT_TIMEOUT_MS = 60_000;
const VALID_NAVIGATION_WAIT_UNTIL = new Set<NonNullable<NavigationOptions['waitUntil']>>([
  'load',
  'domcontentloaded',
  'networkidle',
]);

function requiresHttpNavigationResponse(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return true;
  }
}

function validateBoundedInteger(value: number, fieldName: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new PageActionInputError(
      `${fieldName} must be an integer between ${min} and ${max} milliseconds.`,
    );
  }
}

function normalizeActionOptions(options: ActionOptions, fieldName: string): ActionOptions {
  if (options.timeout !== undefined) {
    validateBoundedInteger(options.timeout, fieldName, 1, MAX_ACTION_TIMEOUT_MS);
  }

  return options.timeout === undefined ? {} : { timeout: options.timeout };
}

function normalizeNavigationOptions(options: NavigationOptions): NavigationOptions {
  if (options.timeout !== undefined) {
    validateBoundedInteger(options.timeout, 'NavigationOptions.timeout', 1, MAX_ACTION_TIMEOUT_MS);
  }

  if (options.waitUntil !== undefined && !VALID_NAVIGATION_WAIT_UNTIL.has(options.waitUntil)) {
    throw new PageActionInputError(
      'NavigationOptions.waitUntil must be one of: load, domcontentloaded, networkidle.',
    );
  }

  return { ...options };
}

function actionContextFor(
  type: SelfHealingActionType,
  target: string,
  metadata: ActionOptions = {},
): ActionContext {
  return {
    type,
    target,
    targetAlias: metadata.targetAlias,
    expectedRole: metadata.expectedRole,
    expectedName: metadata.expectedName,
    selectorId: metadata.selectorId,
  };
}

export class PageActionError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message, originalError === undefined ? undefined : { cause: originalError });
    this.name = 'PageActionError';
  }
}

export class PageActionInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'PageActionInputError';
  }
}

// Abstract class for Page Objects
export abstract class PageObjectBase {
  protected page: Page;
  protected logger: Logger;
  protected url: string;
  protected pageObjectName: string;
  protected runId: string;
  protected testId?: string;
  protected readonly context: AuroraFlowContext;
  private readonly actionPipeline: PageActionPipeline;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    page: Page,
    pageObjectName: string = new.target.name,
    context: AuroraFlowContext = createAuroraFlowContext(),
  ) {
    this.page = page;
    this.pageObjectName = pageObjectName;
    this.context = context;
    const correlationIdentifiers = context.resolveCorrelation();
    this.runId = correlationIdentifiers.runId;
    this.testId = correlationIdentifiers.testId;
    this.logger = context.createLogger(pageObjectName, {
      runId: this.runId,
      testId: this.testId,
    });
    this.actionPipeline = new PageActionPipeline({
      page: this.page,
      execute: <T>(execution: PageActionPipelineExecution<T>) =>
        this.safeAction(
          execution.action,
          execution.successMessage,
          execution.errorMessage,
          execution.actionContext,
          execution.guardedAutoHealAction,
        ),
      resolveGuardedLocator: (locatorExpression) => this.resolveGuardedLocator(locatorExpression),
    });
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
    const telemetry = this.context.getTelemetry();
    return telemetry.runSpan({
      name: SPAN_NAMES.pageAction,
      attributes: buildPageActionSpanAttributes({
        pageObjectName: this.pageObjectName,
        actionType: actionContext.type,
        target: actionContext.target,
        runId: this.runId,
        testId: this.testId,
        exportRawTarget: telemetry.config.exportRawSelectors,
      }),
      task: (span) =>
        this.safeActionWithTelemetry({
          action,
          successMessage,
          errorMessage,
          actionContext,
          guardedAutoHealAction,
          requiresInitialization,
          span,
        }),
    });
  }

  protected resolveRegistryRuntime(
    config: SelfHealingConfig,
  ): SelfHealingRegistryRuntime | undefined {
    return this.context.resolveRegistryRuntime(config);
  }

  private async safeActionWithTelemetry<T>({
    action,
    successMessage,
    errorMessage,
    actionContext,
    guardedAutoHealAction,
    requiresInitialization,
    span,
  }: {
    action: () => Promise<T>;
    successMessage: string;
    errorMessage: string;
    actionContext: ActionContext;
    guardedAutoHealAction?: GuardedAutoHealAction<T>;
    requiresInitialization: boolean;
    span: TelemetrySpan;
  }): Promise<T> {
    const telemetry = this.context.getTelemetry();
    const startedAt = this.context.clock.now();
    let actionStatus: PageActionMetricStatus = 'failed';
    let errorCode: string | undefined;
    let actionError: Error | undefined;
    let guardedValidation: Awaited<ReturnType<typeof evaluateGuardedSuggestionsDryRun>> | undefined;
    let guardedAutoHeal: GuardedAutoHealSummary | undefined;
    let registryPersistence: SelfHealingRegistryPersistenceSummary | undefined;
    let failurePathStartedAt: number | undefined;
    let selfHealingConfig: SelfHealingConfig | undefined;

    try {
      if (requiresInitialization) {
        await this.ensureInitialized();
      }
      const result = await action();
      actionStatus = 'succeeded';
      this.logger.info(successMessage, { result });
      return result;
    } catch (error) {
      failurePathStartedAt = this.context.clock.now();
      actionError = error instanceof Error ? error : new Error(String(error));
      errorCode = `page_action_${actionContext.type}_failed`;
      span.recordException(actionError);
      this.logger.error(errorMessage, { error });
      const activeSelfHealingConfig = this.context.resolveSelfHealingConfig();
      selfHealingConfig = activeSelfHealingConfig;
      const runBudget = consumeSelfHealingRunBudget(
        this.context,
        activeSelfHealingConfig,
        this.logger,
      );
      span.setAttribute('auroraflow.self_heal.mode', selfHealingConfig.mode);
      span.setAttribute('auroraflow.self_heal.run_budget.mode', runBudget.mode);
      span.setAttribute(
        'auroraflow.self_heal.run_budget.healing_attempt_sequence',
        runBudget.healingAttemptSequence,
      );
      span.setAttribute(
        'auroraflow.self_heal.run_budget.failure_artifact_sequence',
        runBudget.failureArtifactSequence,
      );
      span.setAttribute(
        'auroraflow.self_heal.run_budget.should_run_healing',
        runBudget.shouldRunHealing,
      );
      span.setAttribute(
        'auroraflow.self_heal.run_budget.should_capture_artifact',
        runBudget.shouldCaptureArtifact,
      );
      span.setAttribute('auroraflow.self_heal.run_budget.downgrade', runBudget.downgrade);
      const artifactPrivacyPolicy = this.resolveArtifactPrivacyPolicy();
      // Capture a failure screenshot on the active healing path, and also when
      // self-healing is `off`: an off-mode run intentionally still records basic
      // failure evidence (a screenshot) even though it writes no self-healing
      // event artifact. A budget downgrade in a non-off mode (shouldRunHealing
      // false) intentionally stops screenshots to bound failure-storm cost.
      const screenshotPath =
        (selfHealingConfig.mode === 'off' || runBudget.shouldRunHealing) &&
        artifactPrivacyPolicy.screenshot.mode === 'capture'
          ? this.buildFailureScreenshotPath(errorMessage)
          : undefined;
      const currentUrl = this.resolveCurrentUrl();

      if (screenshotPath !== undefined) {
        await captureFailureScreenshot(this.page, screenshotPath, artifactPrivacyPolicy).catch(
          (screenshotError) =>
            this.logger.error('Failed to take a screenshot.', { screenshotError }),
        );
      }

      const registryRuntime = runBudget.shouldRunHealing
        ? this.resolveRegistryRuntime(selfHealingConfig)
        : undefined;
      const rankedSuggestions = runBudget.shouldRunHealing
        ? generateRankedLocatorSuggestions({
            actionType: actionContext.type,
            failedTarget: actionContext.target,
            telemetry,
          })
        : [];
      const failureActionContext = {
        type: actionContext.type,
        target: actionContext.target,
        targetAlias: actionContext.targetAlias,
        expectedRole: actionContext.expectedRole,
        expectedName: actionContext.expectedName,
        selectorId: actionContext.selectorId,
        description: errorMessage,
      };
      let selfHealingAnalysis: Awaited<ReturnType<typeof analyzeSelfHealingFailure>> | undefined;
      if (runBudget.shouldRunHealing) {
        try {
          selfHealingAnalysis = await analyzeSelfHealingFailure({
            page: this.page,
            config: selfHealingConfig,
            pageObjectName: this.pageObjectName,
            action: failureActionContext,
            currentUrl,
            existingSuggestions: rankedSuggestions,
            registryRuntime,
            privacyPolicy: artifactPrivacyPolicy,
            telemetry,
            now: this.context.clock.now,
          });
          if (selfHealingAnalysis.sat) {
            span.setAttribute(
              'auroraflow.self_heal.sat.candidate_count',
              selfHealingAnalysis.sat.candidates.length,
            );
            span.setAttribute(
              'auroraflow.self_heal.registry.history_loaded_candidates',
              selfHealingAnalysis.sat.history.loadedCandidates,
            );
            span.setAttribute(
              'auroraflow.self_heal.registry.warning_count',
              selfHealingAnalysis.sat.history.warnings.length,
            );
          }
        } catch (analysisError: unknown) {
          this.logger.error('Failed to analyze self-healing failure.', { analysisError });
        }
      }
      let guardedAutoHealResult: T | undefined;

      if (runBudget.shouldRunHealing && selfHealingConfig.mode === 'guarded') {
        const satCandidates = selfHealingAnalysis?.sat?.candidates ?? [];
        const guardedSuggestions = satCandidates.length > 0 ? satCandidates : rankedSuggestions;
        guardedValidation = await evaluateGuardedSuggestionsDryRun({
          page: this.page,
          actionType: actionContext.type,
          minConfidence: selfHealingConfig.minConfidence,
          suggestions: guardedSuggestions,
          currentUrl,
          safetyPolicy: selfHealingConfig.safetyPolicy,
          maxCandidates: selfHealingConfig.sat.maxCandidates,
          telemetry,
        });
        const acceptedCandidate = guardedValidation.candidates.find(
          (candidate) => candidate.locator === guardedValidation?.acceptedLocator,
        );
        if (acceptedCandidate !== undefined) {
          span.setAttribute(
            'auroraflow.self_heal.accepted_locator_strategy',
            acceptedCandidate.strategy,
          );
        }

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

      if (runBudget.shouldCaptureArtifact) {
        await captureFailureEvent({
          config: selfHealingConfig,
          // Route artifacts to the context-owned root so two contexts isolate
          // their output without reading or mutating `SELF_HEAL_ARTIFACTS_DIR`.
          writer: createFileFailureArtifactWriter(this.context.resolveArtifactRoot()),
          pageObjectName: this.pageObjectName,
          currentUrl,
          screenshotPath,
          privacyPolicy: artifactPrivacyPolicy,
          action: failureActionContext,
          error,
          suggestions: selfHealingAnalysis?.suggestions ?? rankedSuggestions,
          correlation: {
            runId: this.runId,
            testId: this.testId,
            component: this.pageObjectName,
            errorCode: `page_action_${actionContext.type}_failed`,
          },
          telemetry,
          decorateEvent: async (event) => {
            if (selfHealingAnalysis?.sat) {
              event.sat = selfHealingAnalysis.sat;
            }
            if (guardedValidation) {
              event.guardedValidation = guardedValidation;
            }
            if (guardedAutoHeal) {
              event.guardedAutoHeal = guardedAutoHeal;
            }
            if (
              runBudget.shouldRunHealing &&
              activeSelfHealingConfig.sat.registryMode === 'write_pending'
            ) {
              registryPersistence = await persistSelfHealingRegistryTelemetry({
                config: activeSelfHealingConfig,
                event,
                registryRuntime,
                telemetry,
              });
              event.registryPersistence = registryPersistence;
            }
          },
        }).catch((captureError) =>
          this.logger.error('Failed to capture self-healing failure artifact.', { captureError }),
        );
      }

      if (registryPersistence) {
        span.setAttribute(
          'auroraflow.self_heal.registry.history_write_succeeded',
          registryPersistence.history.succeeded,
        );
        span.setAttribute(
          'auroraflow.self_heal.registry.history_write_failed',
          registryPersistence.history.failed,
        );
        span.setAttribute(
          'auroraflow.self_heal.registry.promotion_write_status',
          registryPersistence.promotion.status,
        );
        span.setAttribute(
          'auroraflow.self_heal.registry.persistence_warning_count',
          registryPersistence.warnings.length,
        );
      }

      if (guardedAutoHeal?.attempted && guardedAutoHeal.succeeded) {
        actionStatus = 'self_healed';
        return guardedAutoHealResult as T;
      }

      throw new PageActionError(
        `${errorMessage}: ${error instanceof Error ? error.message : 'Unknown Error'}`,
        error instanceof Error ? error : undefined,
      );
    } finally {
      const durationMs = this.context.clock.now() - startedAt;
      span.setAttribute('auroraflow.action.succeeded', actionStatus !== 'failed');
      span.setAttribute('auroraflow.action.status', actionStatus);
      span.setAttribute('auroraflow.action.duration_ms', durationMs);
      if (errorCode !== undefined) {
        span.setAttribute('error.code', errorCode);
      }
      if (actionError !== undefined) {
        span.setAttribute('error.type', actionError.name);
      }
      const metricAttributes = buildPageActionMetricAttributes({
        pageObjectName: this.pageObjectName,
        actionType: actionContext.type,
        status: actionStatus,
        errorCode,
      });
      telemetry.recordCounter(METRIC_NAMES.pageActionsTotal, 1, metricAttributes);
      telemetry.recordHistogram(METRIC_NAMES.pageActionDurationMs, durationMs, metricAttributes);
      if (failurePathStartedAt !== undefined && selfHealingConfig !== undefined) {
        telemetry.recordHistogram(
          METRIC_NAMES.selfHealingFailurePathDurationMs,
          Math.max(0, this.context.clock.now() - failurePathStartedAt),
          buildSelfHealingDurationMetricAttributes({
            mode: selfHealingConfig.mode,
            actionType: actionContext.type,
            operation: 'failure_path',
            status: actionStatus,
            pageObjectName: this.pageObjectName,
          }),
        );
      }
      if (actionStatus === 'failed') {
        telemetry.recordCounter(METRIC_NAMES.pageActionFailuresTotal, 1, metricAttributes);
      }
      if (guardedAutoHeal !== undefined) {
        const guardedAutoHealStatus: GuardedAutoHealMetricStatus = guardedAutoHeal.attempted
          ? guardedAutoHeal.succeeded
            ? 'succeeded'
            : 'failed'
          : 'skipped';
        span.setAttribute('auroraflow.self_heal.auto_apply.status', guardedAutoHealStatus);
        telemetry.recordCounter(
          METRIC_NAMES.guardedAutoHealTotal,
          1,
          buildGuardedAutoHealMetricAttributes({
            actionType: actionContext.type,
            status: guardedAutoHealStatus,
            skippedReason: guardedAutoHeal.skippedReason,
          }),
        );
      }
    }
  }

  private buildFailureScreenshotPath(errorMessage: string): string {
    const timestamp = this.context.clock.currentDate().toISOString().replace(/[:.]/g, '-');
    const sanitizedMessage = errorMessage.replace(/[^a-z0-9]/gi, '_');
    return `test-results/screenshots/${timestamp}_${sanitizedMessage}.png`;
  }

  protected resolveArtifactPrivacyPolicy(): ArtifactPrivacyPolicy {
    return this.context.resolveArtifactPrivacyPolicy((diagnostic) => this.logger.warn(diagnostic));
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
  ): Promise<Response | null> {
    const navigationOptions = normalizeNavigationOptions(options);

    return this.safeAction(
      async () => {
        const response: Response | null = await this.page.goto(url, navigationOptions);
        if (!response) {
          if (requiresHttpNavigationResponse(url)) {
            throw new Error(`Navigation to ${url} failed without a main resource response`);
          }
          return null;
        }
        if (!response.ok()) {
          throw new Error(`Navigation to ${url} failed with status: ${response.status()}`);
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
    return this.safeAction(
      () => this.page.title(),
      'Retrieved page title',
      'Error retrieving page title',
      { type: 'read', target: 'page.title' },
    );
  }

  public async click(selector: string, options: ActionOptions = {}): Promise<void | null> {
    const actionOptions = normalizeActionOptions(options, 'ActionOptions.timeout');

    return this.actionPipeline.click({
      selector,
      actionOptions,
      actionContext: actionContextFor('click', selector, options),
    });
  }

  protected async clickWhenVisible(selector: string, options: ActionOptions = {}): Promise<void> {
    const actionOptions = normalizeActionOptions(options, 'ActionOptions.timeout');
    const waitOptions = { ...actionOptions, state: 'visible' as const };

    return this.safeAction(
      async () => {
        await this.page.waitForSelector(selector, waitOptions);
        await this.page.click(selector, actionOptions);
      },
      `Clicked on visible selector: ${selector}`,
      `Error clicking on visible selector ${selector}`,
      actionContextFor('click', selector, options),
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator).first();
        await locator.waitFor(waitOptions);
        await locator.click(actionOptions);
      },
    );
  }

  public async type(
    selector: string,
    text: string,
    options: ActionOptions = {},
  ): Promise<void | null> {
    const actionOptions = normalizeActionOptions(options, 'ActionOptions.timeout');

    return this.actionPipeline.type({
      selector,
      text,
      actionOptions,
      actionContext: actionContextFor('type', selector, options),
    });
  }

  public async getText(selector: string, options: ActionOptions = {}): Promise<string | null> {
    const actionOptions = normalizeActionOptions(options, 'ActionOptions.timeout');

    return this.safeAction(
      () => this.page.textContent(selector, actionOptions),
      `Retrieved text from selector: ${selector}`,
      `Error retrieving text from selector ${selector}`,
      actionContextFor('read', selector, options),
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator);
        return locator.first().textContent(actionOptions);
      },
    );
  }

  public async waitForSelector(
    selector: string,
    options: ActionOptions = {},
  ): Promise<ElementHandle<unknown> | null> {
    const actionOptions = normalizeActionOptions(options, 'ActionOptions.timeout');

    return this.safeAction(
      () => this.page.waitForSelector(selector, actionOptions),
      `Waited for selector: ${selector}`,
      `Error waiting for selector ${selector}`,
      actionContextFor('wait', selector, options),
      async (acceptedLocator) => {
        const locator = this.resolveGuardedLocator(acceptedLocator).first();
        await locator.waitFor({ state: 'attached', timeout: actionOptions.timeout });
        return locator.elementHandle();
      },
    );
  }

  public async waitForTimeout(timeout: number): Promise<this> {
    validateBoundedInteger(timeout, 'waitForTimeout timeout', 0, MAX_EXPLICIT_WAIT_TIMEOUT_MS);

    await this.safeAction(
      () => this.page.waitForTimeout(timeout),
      `Waited for timeout: ${timeout}ms`,
      `Error waiting for timeout ${timeout}ms`,
      { type: 'wait', target: `timeout:${timeout}` },
    );
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
