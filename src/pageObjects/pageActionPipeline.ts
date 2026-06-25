import type { Locator, Page } from 'playwright';
import type { ActionContext, ActionOptions } from './pageObjectBase';

export type PageActionPipelineActionOptions = Readonly<Pick<ActionOptions, 'timeout'>>;

type GuardedAutoHealAction<T> = (acceptedLocator: string) => Promise<T>;

export interface PageActionPipelineExecution<T> {
  action: () => Promise<T>;
  successMessage: string;
  errorMessage: string;
  actionContext: ActionContext;
  guardedAutoHealAction?: GuardedAutoHealAction<T>;
}

export type PageActionPipelineExecutor = <T>(
  execution: PageActionPipelineExecution<T>,
) => Promise<T>;

export interface PageActionPipelinePorts {
  page: Pick<Page, 'click' | 'fill'>;
  execute: PageActionPipelineExecutor;
  resolveGuardedLocator: (locatorExpression: string) => Locator;
}

export interface ClickActionPipelineInput {
  selector: string;
  actionOptions: PageActionPipelineActionOptions;
  actionContext: ActionContext;
}

export interface TypeActionPipelineInput extends ClickActionPipelineInput {
  text: string;
}

/** Internal executor for page-object actions migrated behind the public facade. */
export class PageActionPipeline {
  constructor(private readonly ports: PageActionPipelinePorts) {}

  public click({
    selector,
    actionOptions,
    actionContext,
  }: ClickActionPipelineInput): Promise<void | null> {
    return this.ports.execute({
      action: () => this.ports.page.click(selector, actionOptions),
      successMessage: `Clicked on selector: ${selector}`,
      errorMessage: `Error clicking on selector ${selector}`,
      actionContext,
      guardedAutoHealAction: async (acceptedLocator) => {
        const locator = this.ports.resolveGuardedLocator(acceptedLocator);
        await locator.first().click(actionOptions);
        return null;
      },
    });
  }

  public type({
    selector,
    text,
    actionOptions,
    actionContext,
  }: TypeActionPipelineInput): Promise<void | null> {
    return this.ports.execute({
      action: () => this.ports.page.fill(selector, text, actionOptions),
      successMessage: `Typed text in selector: ${selector}`,
      errorMessage: `Error typing in selector ${selector}`,
      actionContext,
      guardedAutoHealAction: async (acceptedLocator) => {
        const locator = this.ports.resolveGuardedLocator(acceptedLocator);
        await locator.first().fill(text, actionOptions);
        return null;
      },
    });
  }
}
