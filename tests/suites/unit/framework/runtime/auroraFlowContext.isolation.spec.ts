import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPAN_NAMES } from '../../../../../src/framework/observability/attributes';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { resolveSelfHealingConfig } from '../../../../../src/framework/selfHealing/config';
import type { SelfHealingConfig } from '../../../../../src/framework/selfHealing/types';
import {
  createAuroraFlowContext,
  type AuroraFlowContext,
} from '../../../../../src/framework/runtime/auroraFlowContext';
import { PageFactory } from '../../../../../src/helpers/pageFactory';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';
import { CapturingTelemetry } from '../observability/capturingTelemetry';
import {
  cleanupSelfHealingArtifactScope,
  createVitestSelfHealingArtifactScope,
  type SelfHealingArtifactScope,
} from '../../../../helpers/selfHealingArtifacts';

class ContextPage extends PageObjectBase {
  constructor(page: Page, context?: AuroraFlowContext) {
    super(page, 'ContextPage', context);
  }
}

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  textContent: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
};

function createPageMock(): PageMock {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    textContent: vi.fn().mockResolvedValue('text'),
    title: vi.fn().mockResolvedValue('title'),
    url: vi.fn().mockReturnValue('https://example.test/page'),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

// Builds a real config from an explicit env map so the test never touches
// `process.env` for self-healing configuration (the AUR-IMPL-021 seam). SAT is
// disabled to keep the failure path off the DOM-capture/guarded-resolution code
// the isolation contract does not exercise.
function buildConfig(env: Readonly<Record<string, string | undefined>>): SelfHealingConfig {
  return resolveSelfHealingConfig({ SELF_HEAL_SAT_ENABLED: 'false', ...env });
}

// AUR-IMPL-021 owns the page-object facade's telemetry resolution: the
// page-action span and its counters. Downstream self-healing subsystems
// (suggestion engine, guarded validation, failure capture) still record to the
// telemetry module singleton until the AUR-IMPL-022 action pipeline threads the
// context through them, so isolation is asserted on the facade surface only.
const PAGE_ACTION_COUNTER_NAMES = new Set<string>([
  METRIC_NAMES.pageActionsTotal,
  METRIC_NAMES.pageActionFailuresTotal,
]);

function pageActionSpans(telemetry: CapturingTelemetry) {
  return telemetry.spans.filter((span) => span.name === SPAN_NAMES.pageAction);
}

function pageActionCounters(telemetry: CapturingTelemetry) {
  return telemetry.counters.filter((counter) => PAGE_ACTION_COUNTER_NAMES.has(counter.name));
}

describe('AuroraFlowContext two-context isolation', () => {
  let scope: SelfHealingArtifactScope | undefined;
  let globalTelemetry: CapturingTelemetry;

  beforeEach(async () => {
    scope = await createVitestSelfHealingArtifactScope({ prefix: 'auroraflow-context-isolation' });
    // Only the artifact output directory is env-backed in this task; scope it to
    // a temp dir so suggest/guarded failures do not write into the repo.
    process.env.SELF_HEAL_ARTIFACTS_DIR = scope.artifactsDir;
    // Decoys: an isolated context must ignore process env and the telemetry
    // singleton entirely.
    process.env.SELF_HEAL_MODE = 'off';
    process.env.AURORAFLOW_RUN_ID = 'env-run';
    globalTelemetry = new CapturingTelemetry();
    setTelemetryForTests(globalTelemetry);
  });

  afterEach(async () => {
    delete process.env.SELF_HEAL_ARTIFACTS_DIR;
    delete process.env.SELF_HEAL_MODE;
    delete process.env.AURORAFLOW_RUN_ID;
    resetTelemetryForTests();
    await cleanupSelfHealingArtifactScope(scope);
    scope = undefined;
  });

  it('routes telemetry, self-healing config, and correlation per context without env or singleton bleed', async () => {
    const telemetryA = new CapturingTelemetry();
    const telemetryB = new CapturingTelemetry();
    const contextA = createAuroraFlowContext({
      telemetry: telemetryA,
      selfHealingConfig: buildConfig({
        SELF_HEAL_MODE: 'suggest',
        SELF_HEAL_MIN_CONFIDENCE: '0.5',
      }),
      correlation: { runId: 'run-A', testId: 'test-A' },
    });
    const contextB = createAuroraFlowContext({
      telemetry: telemetryB,
      selfHealingConfig: buildConfig({
        SELF_HEAL_MODE: 'guarded',
        SELF_HEAL_MIN_CONFIDENCE: '0.99',
      }),
      correlation: { runId: 'run-B', testId: 'test-B' },
    });

    const pageMockA = createPageMock();
    const pageMockB = createPageMock();
    pageMockA.fill.mockRejectedValueOnce(new Error('fill failed A'));
    pageMockB.fill.mockRejectedValueOnce(new Error('fill failed B'));

    const pageObjectA = new ContextPage(pageMockA as unknown as Page, contextA);
    const pageObjectB = new ContextPage(pageMockB as unknown as Page, contextB);

    await expect(pageObjectA.type('#a', 'x')).rejects.toThrow(
      'Error typing in selector #a: fill failed A',
    );
    await expect(pageObjectB.type('#b', 'y')).rejects.toThrow(
      'Error typing in selector #b: fill failed B',
    );

    // Facade telemetry isolation: each context sink owns its page-action span;
    // the module singleton receives no page-action telemetry at all.
    expect(telemetryA.spans).toHaveLength(1);
    expect(telemetryB.spans).toHaveLength(1);
    expect(telemetryA.spans[0].name).toBe(SPAN_NAMES.pageAction);
    expect(telemetryB.spans[0].name).toBe(SPAN_NAMES.pageAction);
    expect(pageActionSpans(globalTelemetry)).toHaveLength(0);
    expect(pageActionCounters(globalTelemetry)).toHaveLength(0);

    // Self-healing config isolation: each span reflects its context's mode, not
    // the `SELF_HEAL_MODE=off` decoy in process.env.
    expect(telemetryA.spans[0].attributes['auroraflow.self_heal.mode']).toBe('suggest');
    expect(telemetryB.spans[0].attributes['auroraflow.self_heal.mode']).toBe('guarded');

    // Correlation isolation: each span carries its context's run/test id, not the
    // `AURORAFLOW_RUN_ID=env-run` decoy.
    expect(telemetryA.spans[0].attributes['auroraflow.run_id']).toBe('run-A');
    expect(telemetryA.spans[0].attributes['auroraflow.test_id']).toBe('test-A');
    expect(telemetryB.spans[0].attributes['auroraflow.run_id']).toBe('run-B');
    expect(telemetryB.spans[0].attributes['auroraflow.test_id']).toBe('test-B');

    // Failure counters are routed to the owning context only.
    expect(
      telemetryA.counters.some((counter) => counter.name === METRIC_NAMES.pageActionFailuresTotal),
    ).toBe(true);
    expect(
      telemetryB.counters.some((counter) => counter.name === METRIC_NAMES.pageActionFailuresTotal),
    ).toBe(true);
  });

  it('threads the context through registered PageFactory providers', async () => {
    const telemetry = new CapturingTelemetry();
    const context = createAuroraFlowContext({
      telemetry,
      selfHealingConfig: buildConfig({ SELF_HEAL_MODE: 'suggest' }),
      correlation: { runId: 'factory-run', testId: 'factory-test' },
    });
    const pageMock = createPageMock();
    pageMock.fill.mockRejectedValueOnce(new Error('factory fill failed'));
    const factory = new PageFactory(pageMock as unknown as Page, context);
    factory.registerPageProvider(
      ContextPage,
      (providerPage, providerContext) => new ContextPage(providerPage, providerContext),
    );

    const pageObject = factory.getPage(ContextPage);
    await expect(pageObject.type('#f', 'z')).rejects.toThrow(
      'Error typing in selector #f: factory fill failed',
    );

    expect(telemetry.spans).toHaveLength(1);
    expect(telemetry.spans[0].name).toBe(SPAN_NAMES.pageAction);
    expect(telemetry.spans[0].attributes['auroraflow.run_id']).toBe('factory-run');
    expect(telemetry.spans[0].attributes['auroraflow.self_heal.mode']).toBe('suggest');
    expect(pageActionSpans(globalTelemetry)).toHaveLength(0);
  });
});
