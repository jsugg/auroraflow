import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPageActionMetricAttributes } from '../../../../../src/framework/observability/attributes';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  createAuroraFlowContext,
  type AuroraFlowContext,
} from '../../../../../src/framework/runtime/auroraFlowContext';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';
import { CapturingTelemetry, type CapturedAttributes } from '../observability/capturingTelemetry';

class TestPageObject extends PageObjectBase {
  constructor(page: Page, context: AuroraFlowContext) {
    super(page, 'TelemetryPageObject', context);
  }

  public clickVisible(selector: string): Promise<void> {
    return this.clickWhenVisible(selector);
  }
}

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
};

function createPageMock(): PageMock {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    title: vi.fn().mockResolvedValue('Telemetry title'),
    url: vi.fn().mockReturnValue('https://example.test/login'),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PageObjectBase telemetry integration', () => {
  let pageMock: PageMock;
  let telemetry: CapturingTelemetry;
  let pageObject: TestPageObject;

  beforeEach(() => {
    telemetry = new CapturingTelemetry();
    pageMock = createPageMock();
    // The injected context owns telemetry and correlation, so the facade never
    // reads `process.env` or the telemetry singleton — keeping the spec
    // parallel-safe with no ambient state to set or restore.
    pageObject = new TestPageObject(
      pageMock as unknown as Page,
      createAuroraFlowContext({
        telemetry,
        correlation: { runId: 'run-1', testId: 'test-1' },
      }),
    );
  });

  it('records selector-safe spans and metrics for successful actions', async () => {
    await expect(pageObject.type('#username', 'alice')).resolves.toBeUndefined();

    expect(telemetry.spans).toHaveLength(1);
    expect(telemetry.spans[0]).toMatchObject({
      name: 'auroraflow.page_action',
      status: { code: 'ok' },
    });
    expect(telemetry.spans[0].attributes).toMatchObject({
      'auroraflow.page_object': 'TelemetryPageObject',
      'auroraflow.action.type': 'type',
      'auroraflow.action.target_kind': 'css',
      'auroraflow.action.succeeded': true,
      'auroraflow.action.status': 'succeeded',
      'auroraflow.run_id': 'run-1',
      'auroraflow.test_id': 'test-1',
    });
    expect(telemetry.spans[0].attributes['auroraflow.action.target_hash']).toBeTypeOf('string');
    expect(Object.values(telemetry.spans[0].attributes)).not.toContain('#username');

    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.pageActionsTotal,
      value: 1,
      attributes: buildPageActionMetricAttributes({
        pageObjectName: 'TelemetryPageObject',
        actionType: 'type',
        status: 'succeeded',
      }),
    });
    expect(telemetry.histograms).toHaveLength(1);
    expect(telemetry.histograms[0]).toMatchObject({
      name: METRIC_NAMES.pageActionDurationMs,
      attributes: expect.objectContaining({
        'auroraflow.action.status': 'succeeded',
      }) as CapturedAttributes,
    });
    expect(telemetry.histograms[0].value).toBeGreaterThanOrEqual(0);
  });

  it('records telemetry for title, explicit wait, and clickWhenVisible actions', async () => {
    await expect(pageObject.getTitle()).resolves.toBe('Telemetry title');
    await expect(pageObject.waitForTimeout(25)).resolves.toBe(pageObject);
    await expect(pageObject.clickVisible('#submit')).resolves.toBeUndefined();

    expect(telemetry.spans.map((span) => span.attributes['auroraflow.action.type'])).toEqual([
      'read',
      'wait',
      'click',
    ]);
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.pageActionsTotal,
      value: 1,
      attributes: buildPageActionMetricAttributes({
        pageObjectName: 'TelemetryPageObject',
        actionType: 'read',
        status: 'succeeded',
      }),
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.pageActionsTotal,
      value: 1,
      attributes: buildPageActionMetricAttributes({
        pageObjectName: 'TelemetryPageObject',
        actionType: 'wait',
        status: 'succeeded',
      }),
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.pageActionsTotal,
      value: 1,
      attributes: buildPageActionMetricAttributes({
        pageObjectName: 'TelemetryPageObject',
        actionType: 'click',
        status: 'succeeded',
      }),
    });
    expect(pageMock.waitForSelector).toHaveBeenCalledWith('#submit', { state: 'visible' });
    expect(pageMock.click).toHaveBeenCalledWith('#submit', {});
  });

  it('records failure counters and normalized error metadata for failed actions', async () => {
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#password', 'secret')).rejects.toThrow(
      'Error typing in selector #password: fill failed',
    );

    expect(telemetry.spans).toHaveLength(1);
    expect(telemetry.spans[0].status?.code).toBe('error');
    expect(telemetry.spans[0].exceptions[0]?.message).toBe('fill failed');
    expect(telemetry.spans[0].attributes).toMatchObject({
      'auroraflow.action.succeeded': false,
      'auroraflow.action.status': 'failed',
      'error.code': 'page_action_type_failed',
      'error.type': 'Error',
    });
    expect(Object.values(telemetry.spans[0].attributes)).not.toContain('#password');

    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.pageActionFailuresTotal,
      value: 1,
      attributes: buildPageActionMetricAttributes({
        pageObjectName: 'TelemetryPageObject',
        actionType: 'type',
        status: 'failed',
        errorCode: 'page_action_type_failed',
      }),
    });
    expect(telemetry.histograms).toContainEqual({
      name: METRIC_NAMES.selfHealingFailurePathDurationMs,
      value: expect.any(Number) as number,
      attributes: {
        'auroraflow.self_heal.mode': 'off',
        'auroraflow.self_heal.operation': 'failure_path',
        'auroraflow.self_heal.status': 'failed',
        'auroraflow.action.type': 'type',
        'auroraflow.page_object': 'TelemetryPageObject',
      },
    });
  });
});
