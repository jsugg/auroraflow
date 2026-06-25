import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { createAuroraFlowContext } from '../../../../../src/framework/runtime/auroraFlowContext';
import { resolveSelfHealingConfig } from '../../../../../src/framework/selfHealing/config';
import {
  PageActionPipeline,
  type PageActionPipelineExecution,
} from '../../../../../src/pageObjects/pageActionPipeline';
import { PageActionError, PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

type PipelinePageMock = Pick<Page, 'click' | 'fill'>;

type LocatorFirstMock = {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
};

function createPipelineHarness(): {
  page: PipelinePageMock;
  locatorFirst: LocatorFirstMock;
  executions: Array<PageActionPipelineExecution<unknown>>;
  pipeline: PageActionPipeline;
} {
  const page: PipelinePageMock = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
  };
  const locatorFirst: LocatorFirstMock = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const locator = {
    first: vi.fn().mockReturnValue(locatorFirst),
  } as unknown as Locator;
  const executions: Array<PageActionPipelineExecution<unknown>> = [];
  const pipeline = new PageActionPipeline({
    page,
    execute: async <T>(execution: PageActionPipelineExecution<T>): Promise<T> => {
      executions.push(execution);
      return execution.action();
    },
    resolveGuardedLocator: vi.fn().mockReturnValue(locator),
  });

  return { page, locatorFirst, executions, pipeline };
}

type PageObjectPageMock = {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  getByLabel: ReturnType<typeof vi.fn>;
  getByRole: ReturnType<typeof vi.fn>;
  getByTestId: ReturnType<typeof vi.fn>;
  getByText: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
};

function createPageObjectPageMock(): PageObjectPageMock & { locatorFirst: LocatorFirstMock } {
  const locatorFirst: LocatorFirstMock = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const locatorMock = {
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnValue(locatorFirst),
  };

  return {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-12T12:00:00.000Z',
      nodeCount: 0,
      truncated: false,
      elements: [],
    }),
    getByLabel: vi.fn().mockReturnValue(locatorMock),
    getByRole: vi.fn().mockReturnValue(locatorMock),
    getByTestId: vi.fn().mockReturnValue(locatorMock),
    getByText: vi.fn().mockReturnValue(locatorMock),
    locator: vi.fn().mockReturnValue(locatorMock),
    locatorFirst,
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    url: vi.fn().mockReturnValue('https://example.test/page'),
  };
}

class PipelinePageObject extends PageObjectBase {
  constructor(page: Page, artifactRoot: string, telemetry: CapturingTelemetry) {
    super(
      page,
      'PipelinePageObject',
      createAuroraFlowContext({
        telemetry,
        selfHealingConfig: resolveSelfHealingConfig({
          SELF_HEAL_MODE: 'guarded',
          SELF_HEAL_MIN_CONFIDENCE: '0.3',
          SELF_HEAL_ALLOWED_ACTIONS: 'click,type',
          SELF_HEAL_ALLOWED_DOMAINS: 'example.test',
        }),
        correlation: { runId: 'pipeline-run', testId: 'pipeline-test' },
        artifactRoot,
      }),
    );
  }
}

async function expectRejectedPageActionError(action: Promise<unknown>): Promise<PageActionError> {
  try {
    await action;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(PageActionError);
    return error as PageActionError;
  }

  throw new Error('Expected PageActionError rejection.');
}

describe('PageActionPipeline', () => {
  it('delegates click execution and guarded retry through pipeline ports', async () => {
    const { page, locatorFirst, executions, pipeline } = createPipelineHarness();

    await expect(
      pipeline.click({
        selector: '#submit',
        actionOptions: { timeout: 250 },
        actionContext: { type: 'click', target: '#submit' },
      }),
    ).resolves.toBeUndefined();

    expect(page.click).toHaveBeenCalledWith('#submit', { timeout: 250 });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      successMessage: 'Clicked on selector: #submit',
      errorMessage: 'Error clicking on selector #submit',
      actionContext: { type: 'click', target: '#submit' },
    });

    await expect(
      executions[0]?.guardedAutoHealAction?.("page.locator('#healed')"),
    ).resolves.toBeNull();
    expect(locatorFirst.click).toHaveBeenCalledWith({ timeout: 250 });
  });

  it('delegates type execution and guarded retry through pipeline ports', async () => {
    const { page, locatorFirst, executions, pipeline } = createPipelineHarness();

    await expect(
      pipeline.type({
        selector: '#username',
        text: 'alice',
        actionOptions: {},
        actionContext: { type: 'type', target: '#username' },
      }),
    ).resolves.toBeUndefined();

    expect(page.fill).toHaveBeenCalledWith('#username', 'alice', {});
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      successMessage: 'Typed text in selector: #username',
      errorMessage: 'Error typing in selector #username',
      actionContext: { type: 'type', target: '#username' },
    });

    await expect(
      executions[0]?.guardedAutoHealAction?.("page.locator('#healed')"),
    ).resolves.toBeNull();
    expect(locatorFirst.fill).toHaveBeenCalledWith('alice', {});
  });
});

describe('PageObjectBase click/type pipeline facade', () => {
  let artifactRoot: string;
  let contextTelemetry: CapturingTelemetry;
  let globalTelemetry: CapturingTelemetry;

  beforeEach(async () => {
    artifactRoot = await mkdtemp(path.join(tmpdir(), 'auroraflow-page-action-pipeline-'));
    contextTelemetry = new CapturingTelemetry();
    globalTelemetry = new CapturingTelemetry();
    setTelemetryForTests(globalTelemetry);
  });

  afterEach(async () => {
    resetTelemetryForTests();
    await rm(artifactRoot, { recursive: true, force: true });
  });

  it('keeps the original click error as cause when the single guarded retry fails', async () => {
    const pageMock = createPageObjectPageMock();
    const originalError = new Error('click failed');
    pageMock.click.mockRejectedValueOnce(originalError);
    pageMock.locatorFirst.click.mockRejectedValueOnce(new Error('healed click failed'));
    const pageObject = new PipelinePageObject(
      pageMock as unknown as Page,
      artifactRoot,
      contextTelemetry,
    );

    const error = await expectRejectedPageActionError(pageObject.click('#submit'));

    expect(error.message).toBe('Error clicking on selector #submit: click failed');
    expect(error.originalError).toBe(originalError);
    expect(error.cause).toBe(originalError);
    expect(pageMock.click).toHaveBeenCalledTimes(1);
    expect(pageMock.locatorFirst.click).toHaveBeenCalledTimes(1);
    expect(contextTelemetry.counters.map((counter) => counter.name)).toEqual(
      expect.arrayContaining([
        METRIC_NAMES.selfHealingSuggestionsTotal,
        METRIC_NAMES.guardedValidationCandidatesTotal,
        METRIC_NAMES.selfHealingArtifactsTotal,
        METRIC_NAMES.guardedAutoHealTotal,
      ]),
    );
    expect(globalTelemetry.counters).toHaveLength(0);
    expect(globalTelemetry.spans).toHaveLength(0);
  });

  it('keeps the original type error as cause when the single guarded retry fails', async () => {
    const pageMock = createPageObjectPageMock();
    const originalError = new Error('fill failed');
    pageMock.fill.mockRejectedValueOnce(originalError);
    pageMock.locatorFirst.fill.mockRejectedValueOnce(new Error('healed fill failed'));
    const pageObject = new PipelinePageObject(
      pageMock as unknown as Page,
      artifactRoot,
      contextTelemetry,
    );

    const error = await expectRejectedPageActionError(pageObject.type('#username', 'alice'));

    expect(error.message).toBe('Error typing in selector #username: fill failed');
    expect(error.originalError).toBe(originalError);
    expect(error.cause).toBe(originalError);
    expect(pageMock.fill).toHaveBeenCalledTimes(1);
    expect(pageMock.locatorFirst.fill).toHaveBeenCalledTimes(1);
  });
});
