import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPageActionMetricAttributes } from '../../../../../src/framework/observability/attributes';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';
import { CapturingTelemetry, type CapturedAttributes } from '../observability/capturingTelemetry';

class TestPageObject extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'TelemetryPageObject');
  }
}

type PageMock = {
  fill: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
};

function createPageMock(): PageMock {
  return {
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    url: vi.fn().mockReturnValue('https://example.test/login'),
  };
}

describe('PageObjectBase telemetry integration', () => {
  let pageMock: PageMock;
  let telemetry: CapturingTelemetry;
  let pageObject: TestPageObject;

  beforeEach(() => {
    process.env.AURORAFLOW_RUN_ID = 'run-1';
    process.env.AURORAFLOW_TEST_ID = 'test-1';
    telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    pageMock = createPageMock();
    pageObject = new TestPageObject(pageMock as unknown as Page);
  });

  afterEach(() => {
    delete process.env.AURORAFLOW_RUN_ID;
    delete process.env.AURORAFLOW_TEST_ID;
    resetTelemetryForTests();
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
  });
});
