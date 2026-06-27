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
  readSelfHealingArtifactFor,
  readSelfHealingArtifacts,
  type SelfHealingArtifactScope,
} from '../../../../helpers/selfHealingArtifacts';

// Adversarial ambient environment. An isolated context must prefer its explicit
// options over every one of these values and must never fall through to it — so
// this is passed as the context `env` instead of mutating `process.env`, which
// keeps the spec parallel-safe.
const DECOY_ENV = Object.freeze({
  SELF_HEAL_MODE: 'off',
  SELF_HEAL_MIN_CONFIDENCE: '0.01',
  SELF_HEAL_ARTIFACTS_DIR: '/auroraflow-decoy/should-never-be-written',
  AURORAFLOW_RUN_ID: 'env-run',
  AURORAFLOW_TEST_ID: 'env-test',
});

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
// `process.env` for self-healing configuration seam. SAT is
// disabled to keep the failure path off the DOM-capture/guarded-resolution code
// the isolation contract does not exercise.
function buildConfig(env: Readonly<Record<string, string | undefined>>): SelfHealingConfig {
  return resolveSelfHealingConfig({ SELF_HEAL_SAT_ENABLED: 'false', ...env });
}

// The facade resolves telemetry and the artifact root from the context, so both
// page-action telemetry and failure-artifact output are isolated per context.
// Page-action filters keep assertions stable when downstream self-healing spans
// are added to the same context-owned telemetry sink.
function pageActionSpans(telemetry: CapturingTelemetry) {
  return telemetry.spans.filter((span) => span.name === SPAN_NAMES.pageAction);
}

describe('AuroraFlowContext two-context isolation', () => {
  let scopeA: SelfHealingArtifactScope | undefined;
  let scopeB: SelfHealingArtifactScope | undefined;
  let globalTelemetry: CapturingTelemetry;

  // Each context writes failure artifacts to its own injected root, so a separate
  // scope per context proves artifact-root isolation directly.
  function scopes(): { a: SelfHealingArtifactScope; b: SelfHealingArtifactScope } {
    if (scopeA === undefined || scopeB === undefined) {
      throw new Error('Artifact scopes were not initialized for this test.');
    }
    return { a: scopeA, b: scopeB };
  }

  beforeEach(async () => {
    scopeA = await createVitestSelfHealingArtifactScope({
      prefix: 'auroraflow-context-isolation-a',
      runId: 'run-A',
      testId: 'test-A',
    });
    scopeB = await createVitestSelfHealingArtifactScope({
      prefix: 'auroraflow-context-isolation-b',
      runId: 'run-B',
      testId: 'test-B',
    });
    // Singleton decoy: an isolated context must never read the telemetry module
    // singleton. This is a module seam, not `process.env`, so it stays
    // parallel-safe.
    globalTelemetry = new CapturingTelemetry();
    setTelemetryForTests(globalTelemetry);
  });

  afterEach(async () => {
    resetTelemetryForTests();
    await cleanupSelfHealingArtifactScope(scopeA);
    await cleanupSelfHealingArtifactScope(scopeB);
    scopeA = undefined;
    scopeB = undefined;
  });

  it('routes telemetry, self-healing config, and correlation per context without env or singleton bleed', async () => {
    const { a, b } = scopes();
    const telemetryA = new CapturingTelemetry();
    const telemetryB = new CapturingTelemetry();
    const contextA = createAuroraFlowContext({
      env: DECOY_ENV,
      telemetry: telemetryA,
      selfHealingConfig: buildConfig({
        SELF_HEAL_MODE: 'suggest',
        SELF_HEAL_MIN_CONFIDENCE: '0.5',
      }),
      correlation: { runId: a.runId, testId: a.testId },
      artifactRoot: a.artifactsDir,
    });
    const contextB = createAuroraFlowContext({
      env: DECOY_ENV,
      telemetry: telemetryB,
      selfHealingConfig: buildConfig({
        SELF_HEAL_MODE: 'guarded',
        SELF_HEAL_MIN_CONFIDENCE: '0.99',
      }),
      correlation: { runId: b.runId, testId: b.testId },
      artifactRoot: b.artifactsDir,
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

    // Telemetry isolation: each context sink owns its page-action span; the
    // module singleton receives no page-action or downstream self-healing data.
    const telemetryAPageActionSpans = pageActionSpans(telemetryA);
    const telemetryBPageActionSpans = pageActionSpans(telemetryB);
    expect(telemetryAPageActionSpans).toHaveLength(1);
    expect(telemetryBPageActionSpans).toHaveLength(1);
    expect(telemetryAPageActionSpans[0]?.name).toBe(SPAN_NAMES.pageAction);
    expect(telemetryBPageActionSpans[0]?.name).toBe(SPAN_NAMES.pageAction);
    expect(globalTelemetry.spans).toHaveLength(0);
    expect(globalTelemetry.counters).toHaveLength(0);

    // Self-healing config isolation: each span reflects its context's mode, not
    // the `SELF_HEAL_MODE=off` value in the adversarial DECOY_ENV.
    expect(telemetryAPageActionSpans[0]?.attributes['auroraflow.self_heal.mode']).toBe('suggest');
    expect(telemetryBPageActionSpans[0]?.attributes['auroraflow.self_heal.mode']).toBe('guarded');

    // Correlation isolation: each span carries its context's run/test id, not the
    // `AURORAFLOW_RUN_ID=env-run` value in the adversarial DECOY_ENV.
    expect(telemetryAPageActionSpans[0]?.attributes['auroraflow.run_id']).toBe('run-A');
    expect(telemetryAPageActionSpans[0]?.attributes['auroraflow.test_id']).toBe('test-A');
    expect(telemetryBPageActionSpans[0]?.attributes['auroraflow.run_id']).toBe('run-B');
    expect(telemetryBPageActionSpans[0]?.attributes['auroraflow.test_id']).toBe('test-B');

    // Failure counters are routed to the owning context only.
    expect(
      telemetryA.counters.some((counter) => counter.name === METRIC_NAMES.pageActionFailuresTotal),
    ).toBe(true);
    expect(
      telemetryB.counters.some((counter) => counter.name === METRIC_NAMES.pageActionFailuresTotal),
    ).toBe(true);
  });

  it('threads the context through registered PageFactory providers', async () => {
    const { a } = scopes();
    const telemetry = new CapturingTelemetry();
    const context = createAuroraFlowContext({
      env: DECOY_ENV,
      telemetry,
      selfHealingConfig: buildConfig({ SELF_HEAL_MODE: 'suggest' }),
      correlation: { runId: 'factory-run', testId: 'factory-test' },
      // The factory test does not read artifacts; route them to a temp root so
      // the write never falls back to the in-repo default directory.
      artifactRoot: a.artifactsDir,
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

    const telemetryPageActionSpans = pageActionSpans(telemetry);
    expect(telemetryPageActionSpans).toHaveLength(1);
    expect(telemetryPageActionSpans[0]?.name).toBe(SPAN_NAMES.pageAction);
    expect(telemetryPageActionSpans[0]?.attributes['auroraflow.run_id']).toBe('factory-run');
    expect(telemetryPageActionSpans[0]?.attributes['auroraflow.self_heal.mode']).toBe('suggest');
    expect(globalTelemetry.spans).toHaveLength(0);
    expect(globalTelemetry.counters).toHaveLength(0);
  });

  it('writes each context failure artifact to its own injected root', async () => {
    const { a, b } = scopes();
    const contextA = createAuroraFlowContext({
      env: DECOY_ENV,
      telemetry: new CapturingTelemetry(),
      selfHealingConfig: buildConfig({ SELF_HEAL_MODE: 'suggest' }),
      correlation: { runId: a.runId, testId: a.testId },
      artifactRoot: a.artifactsDir,
    });
    const contextB = createAuroraFlowContext({
      env: DECOY_ENV,
      telemetry: new CapturingTelemetry(),
      selfHealingConfig: buildConfig({ SELF_HEAL_MODE: 'suggest' }),
      correlation: { runId: b.runId, testId: b.testId },
      artifactRoot: b.artifactsDir,
    });

    const pageMockA = createPageMock();
    const pageMockB = createPageMock();
    pageMockA.fill.mockRejectedValueOnce(new Error('fill failed A'));
    pageMockB.fill.mockRejectedValueOnce(new Error('fill failed B'));

    await expect(
      new ContextPage(pageMockA as unknown as Page, contextA).type('#a', 'x'),
    ).rejects.toThrow('Error typing in selector #a: fill failed A');
    await expect(
      new ContextPage(pageMockB as unknown as Page, contextB).type('#b', 'y'),
    ).rejects.toThrow('Error typing in selector #b: fill failed B');

    // Each context's artifact is written to its own injected root and keyed by
    // that context's correlation — never to the decoy SELF_HEAL_ARTIFACTS_DIR.
    const artifactA = await readSelfHealingArtifactFor<{ runId: string; testId?: string }>(a);
    const artifactB = await readSelfHealingArtifactFor<{ runId: string; testId?: string }>(b);
    expect(artifactA.runId).toBe('run-A');
    expect(artifactB.runId).toBe('run-B');
    // Cross-root isolation: neither root captured the other context's artifact.
    expect(await readSelfHealingArtifacts(a)).toHaveLength(1);
    expect(await readSelfHealingArtifacts(b)).toHaveLength(1);
  });
});
