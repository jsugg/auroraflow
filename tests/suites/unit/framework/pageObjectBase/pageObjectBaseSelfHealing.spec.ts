import type { Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import type { SelfHealingRegistryRuntime } from '../../../../../src/framework/selfHealing/registryContracts';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

class TestPageObject extends PageObjectBase {
  constructor(
    page: Page,
    private readonly registryRuntime?: SelfHealingRegistryRuntime,
  ) {
    super(page, 'TestPageObject');
  }

  public clickVisible(selector: string): Promise<void> {
    return this.clickWhenVisible(selector);
  }

  protected override resolveRegistryRuntime(): SelfHealingRegistryRuntime | undefined {
    return this.registryRuntime;
  }
}

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  getByLabel: ReturnType<typeof vi.fn>;
  getByRole: ReturnType<typeof vi.fn>;
  getByTestId: ReturnType<typeof vi.fn>;
  getByText: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  textContent: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  locatorFirst: {
    click: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    textContent: ReturnType<typeof vi.fn>;
    waitFor: ReturnType<typeof vi.fn>;
    elementHandle: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
  };
};

function createPageMock(): PageMock {
  const locatorFirst = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    textContent: vi.fn().mockResolvedValue('healed text'),
    waitFor: vi.fn().mockResolvedValue(undefined),
    elementHandle: vi.fn().mockResolvedValue(null),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const locatorMock = {
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnValue(locatorFirst),
  };

  return {
    click: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    getByLabel: vi.fn().mockReturnValue(locatorMock),
    getByRole: vi.fn().mockReturnValue(locatorMock),
    getByTestId: vi.fn().mockReturnValue(locatorMock),
    getByText: vi.fn().mockReturnValue(locatorMock),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    locator: vi.fn().mockReturnValue(locatorMock),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    textContent: vi.fn().mockResolvedValue('text'),
    title: vi.fn().mockResolvedValue('title'),
    url: vi.fn().mockReturnValue('https://example.test/page'),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locatorFirst,
  };
}

describe('PageObjectBase self-healing integration', () => {
  let pageMock: PageMock;
  let pageObject: TestPageObject;
  const artifactsDir = path.join(process.cwd(), 'test-results', 'self-healing');

  beforeEach(async () => {
    process.env.AURORAFLOW_RUN_ID = 'local-run';
    process.env.AURORAFLOW_TEST_ID = 'spec-1';
    process.env.SELF_HEAL_MODE = 'suggest';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.95';
    delete process.env.SELF_HEAL_ALLOWED_ACTIONS;
    delete process.env.SELF_HEAL_ALLOWED_DOMAINS;
    delete process.env.SELF_HEAL_REGISTRY_MODE;
    await rm(artifactsDir, { recursive: true, force: true });
    pageMock = createPageMock();
    pageObject = new TestPageObject(pageMock as unknown as Page);
  });

  afterEach(async () => {
    delete process.env.AURORAFLOW_RUN_ID;
    delete process.env.AURORAFLOW_TEST_ID;
    delete process.env.SELF_HEAL_MODE;
    delete process.env.SELF_HEAL_MIN_CONFIDENCE;
    delete process.env.SELF_HEAL_ALLOWED_ACTIONS;
    delete process.env.SELF_HEAL_ALLOWED_DOMAINS;
    delete process.env.SELF_HEAL_REGISTRY_MODE;
    resetTelemetryForTests();
    await rm(artifactsDir, { recursive: true, force: true });
  });

  it('captures structured failure context for failed type action', async () => {
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#username', 'alice')).rejects.toThrow(
      'Error typing in selector #username: fill failed',
    );

    const artifacts = await readdir(artifactsDir);
    expect(artifacts).toHaveLength(1);

    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      mode: string;
      pageObjectName: string;
      component: string;
      runId: string;
      testId?: string;
      errorCode: string;
      minConfidence: number;
      safetyPolicy: {
        allowedActions: string[];
        allowedDomains: string[];
      };
      action: { type: string; target?: string };
      currentUrl?: string;
      suggestions: Array<{ locator: string; score: number }>;
    };

    expect(content.mode).toBe('suggest');
    expect(content.pageObjectName).toBe('TestPageObject');
    expect(content.component).toBe('TestPageObject');
    expect(content.runId).toBe('local-run');
    expect(content.testId).toBe('spec-1');
    expect(content.errorCode).toBe('page_action_type_failed');
    expect(content.minConfidence).toBe(0.95);
    expect(content.safetyPolicy).toEqual({
      allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
      allowedDomains: [],
    });
    expect(content.currentUrl).toBe('https://example.test/page');
    expect(content.action).toMatchObject({ type: 'type', target: '#username' });
    expect(content.suggestions.length).toBeGreaterThan(0);
    expect(content.suggestions[0]?.score).toBeGreaterThanOrEqual(
      content.suggestions[1]?.score ?? 0,
    );
  });

  it('captures guarded dry-run validation metadata when mode is guarded', async () => {
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'type,click';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#username', 'alice')).resolves.toBeNull();

    const artifacts = await readdir(artifactsDir);
    expect(artifacts).toHaveLength(1);

    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      mode: string;
      guardedValidation?: {
        mode: string;
        actionType: string;
        acceptedLocator?: string;
        policy: {
          actionAllowed: boolean;
          domainAllowed: boolean;
          evaluatedDomain?: string;
          allowedActions: string[];
          allowedDomains: string[];
        };
        candidates: Array<{
          locator: string;
          confidenceEligible: boolean;
          status: string;
        }>;
      };
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        locator?: string;
      };
    };

    expect(content.mode).toBe('guarded');
    expect(content.guardedValidation).toBeDefined();
    expect(content.guardedValidation?.mode).toBe('dry-run');
    expect(content.guardedValidation?.actionType).toBe('type');
    expect(content.guardedValidation?.acceptedLocator).toBeTruthy();
    expect(content.guardedValidation?.policy).toMatchObject({
      actionAllowed: true,
      domainAllowed: true,
      evaluatedDomain: 'example.test',
      allowedActions: ['type', 'click'],
      allowedDomains: ['example.test'],
    });
    expect(content.guardedValidation?.candidates.length).toBeGreaterThan(0);
    expect(
      content.guardedValidation?.candidates.some((candidate) => candidate.status === 'accepted'),
    ).toBe(true);
    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: true,
    });
  });

  it('auto-applies accepted guarded click candidates and records success in artifact', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));

    await expect(pageObject.click('#submit')).resolves.toBeNull();
    expect(pageMock.locatorFirst.click).toHaveBeenCalledTimes(1);

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        locator?: string;
      };
    };

    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: true,
    });
    expect(content.guardedAutoHeal?.locator).toBeTruthy();
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedAutoHealTotal,
      value: 1,
      attributes: {
        'auroraflow.action.type': 'click',
        'auroraflow.self_heal.status': 'succeeded',
      },
    });
    expect(
      telemetry.spans.find((span) => span.name === 'auroraflow.page_action')?.attributes,
    ).toMatchObject({
      'auroraflow.self_heal.auto_apply.status': 'succeeded',
      'auroraflow.self_heal.accepted_locator_strategy': expect.any(String) as string,
    });
  });

  it('uses SAT-ranked registry candidates for guarded validation and retry', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    const registryLocator = "page.getByTestId('submit-order')";
    const runtime: SelfHealingRegistryRuntime = {
      selectors: {
        get: vi.fn().mockResolvedValue({
          id: 'checkout.submit',
          pageObjectName: 'TestPageObject',
          actionType: 'click',
          locator: registryLocator,
          confidence: 0.99,
          updatedAt: '2026-06-08T12:00:00.000Z',
          version: 4,
        }),
        findCandidates: vi.fn().mockResolvedValue([]),
      },
      histories: {
        get: vi.fn().mockResolvedValue(null),
        getMany: vi.fn().mockResolvedValue(new Map()),
      },
      promotions: {
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockImplementation(async (promotion) => promotion),
      },
      required: false,
    };
    pageObject = new TestPageObject(pageMock as unknown as Page, runtime);
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));

    await expect(
      pageObject.click('#legacy-submit', { selectorId: 'checkout.submit' }),
    ).resolves.toBeNull();

    expect(runtime.selectors.get).toHaveBeenCalledWith('checkout.submit');
    expect(pageMock.getByTestId).toHaveBeenCalledWith('submit-order');
    expect(pageMock.locatorFirst.click).toHaveBeenCalledTimes(1);

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      action: { selectorId?: string };
      sat?: {
        candidates: Array<{
          locator: string;
          strategy: string;
          registryRecordId?: string;
          registryRecordVersion?: number;
        }>;
      };
      guardedValidation?: {
        acceptedLocator?: string;
      };
      guardedAutoHeal?: {
        succeeded: boolean;
        locator?: string;
      };
    };

    expect(content.action.selectorId).toBe('checkout.submit');
    expect(content.sat?.candidates[0]).toMatchObject({
      locator: registryLocator,
      strategy: 'registry',
      registryRecordId: 'checkout.submit',
      registryRecordVersion: 4,
    });
    expect(content.guardedValidation?.acceptedLocator).toBe(registryLocator);
    expect(content.guardedAutoHeal).toMatchObject({
      succeeded: true,
      locator: registryLocator,
    });
    expect(
      telemetry.spans.find((span) => span.name === 'auroraflow.page_action')?.attributes,
    ).toMatchObject({
      'auroraflow.self_heal.registry.history_loaded_candidates': 0,
      'auroraflow.self_heal.registry.warning_count': expect.any(Number) as number,
    });
  });

  it('persists write-pending registry telemetry into artifacts after guarded success', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    const recordObservation = vi.fn().mockResolvedValue({
      candidateId: 'candidate',
      attempts: 1,
      validated: 1,
      guardedApplySucceeded: 1,
      guardedApplyFailed: 0,
      promoted: 0,
      rejected: 0,
    });
    const upsertPromotion = vi.fn().mockImplementation(async (promotion) => promotion);
    const runtime: SelfHealingRegistryRuntime = {
      selectors: {
        get: vi.fn().mockResolvedValue({
          id: 'checkout.submit',
          pageObjectName: 'TestPageObject',
          actionType: 'click',
          locator: '#legacy-active',
          confidence: 0.1,
          updatedAt: '2026-06-08T12:00:00.000Z',
          version: 5,
        }),
        findCandidates: vi.fn().mockResolvedValue([]),
      },
      histories: {
        get: vi.fn().mockResolvedValue(null),
        getMany: vi.fn().mockResolvedValue(new Map()),
        recordObservation,
      },
      promotions: {
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        upsert: upsertPromotion,
      },
      required: false,
    };
    pageObject = new TestPageObject(pageMock as unknown as Page, runtime);
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_REGISTRY_MODE = 'write_pending';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));

    await expect(
      pageObject.click('#submit', { selectorId: 'checkout.submit' }),
    ).resolves.toBeNull();

    expect(recordObservation).toHaveBeenCalled();
    expect(upsertPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: expect.any(String) as string,
        selectorId: 'checkout.submit',
        baseSelectorVersion: 5,
        status: 'pending',
      }),
    );

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      eventId: string;
      action: { selectorId?: string };
      guardedValidation?: { acceptedLocator?: string };
      registryPersistence?: {
        history: {
          succeeded: number;
        };
        promotion: {
          status: string;
          eventId?: string;
          selectorId?: string;
        };
      };
    };

    expect(content.action.selectorId).toBe('checkout.submit');
    expect(content.registryPersistence).toMatchObject({
      history: {
        succeeded: expect.any(Number) as number,
      },
      promotion: {
        status: 'succeeded',
        eventId: content.eventId,
        selectorId: 'checkout.submit',
      },
    });
    expect(telemetry.counters).toContainEqual(
      expect.objectContaining({
        name: METRIC_NAMES.selfHealingRegistryWritesTotal,
        attributes: expect.objectContaining({
          'auroraflow.self_heal.registry.operation': 'pending_promotion',
          'auroraflow.self_heal.status': 'succeeded',
        }) as Record<string, unknown>,
      }),
    );
  });

  it('auto-applies accepted guarded clickWhenVisible candidates and records success', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.waitForSelector.mockRejectedValueOnce(new Error('visible wait failed'));

    await expect(pageObject.clickVisible('#submit')).resolves.toBeUndefined();

    expect(pageMock.click).not.toHaveBeenCalled();
    expect(pageMock.locatorFirst.waitFor).toHaveBeenCalledWith({
      state: 'visible',
    });
    expect(pageMock.locatorFirst.click).toHaveBeenCalledWith({});

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      action: { type: string; target?: string };
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        locator?: string;
      };
    };

    expect(content.action).toMatchObject({ type: 'click', target: '#submit' });
    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: true,
    });
    expect(content.guardedAutoHeal?.locator).toBeTruthy();
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedAutoHealTotal,
      value: 1,
      attributes: {
        'auroraflow.action.type': 'click',
        'auroraflow.self_heal.status': 'succeeded',
      },
    });
  });

  it('records guarded auto-heal apply failures without swallowing the original action error', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));
    pageMock.locatorFirst.click.mockRejectedValueOnce(new Error('healed click failed'));

    await expect(pageObject.click('#submit')).rejects.toThrow(
      'Error clicking on selector #submit: click failed',
    );

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        errorMessage?: string;
      };
    };

    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: false,
    });
    expect(content.guardedAutoHeal?.errorMessage).toContain('healed click failed');
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedAutoHealTotal,
      value: 1,
      attributes: {
        'auroraflow.action.type': 'click',
        'auroraflow.self_heal.status': 'failed',
      },
    });
  });

  it('skips guarded auto-heal application when policy blocks candidate validation', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'allowed.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));

    await expect(pageObject.click('#submit')).rejects.toThrow(
      'Error clicking on selector #submit: click failed',
    );

    expect(pageMock.locatorFirst.click).not.toHaveBeenCalled();

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      guardedValidation?: {
        policy: {
          blockedReason?: string;
        };
      };
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        skippedReason?: string;
      };
    };

    expect(content.guardedValidation?.policy.blockedReason).toBe('domain_not_allowed');
    expect(content.guardedAutoHeal).toMatchObject({
      attempted: false,
      succeeded: false,
      skippedReason: 'no_accepted_locator',
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedAutoHealTotal,
      value: 1,
      attributes: {
        'auroraflow.action.type': 'click',
        'auroraflow.self_heal.status': 'skipped',
        'auroraflow.self_heal.skip_reason': 'no_accepted_locator',
      },
    });
  });
});
