import { afterEach, describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { captureFailureEvent } from '../../../../../src/framework/selfHealing/failureCapture';
import { CapturingTelemetry } from '../observability/capturingTelemetry';
import { SENSITIVE_ARTIFACT_PRIVACY_POLICY } from '../../../../../src/framework/selfHealing/artifactPrivacy';
import type {
  SelfHealingConfig,
  SelfHealingMode,
} from '../../../../../src/framework/selfHealing/types';
import {
  cleanupSelfHealingArtifactScope,
  createVitestSelfHealingArtifactScope,
  readSelfHealingArtifactFor,
} from '../../../../helpers/selfHealingArtifacts';

function selfHealingConfig(mode: SelfHealingMode): SelfHealingConfig {
  return {
    mode,
    minConfidence: 0.92,
    safetyPolicy: {
      allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
      allowedDomains: mode === 'guarded' ? ['example.test'] : [],
    },
    sat: {
      enabled: mode !== 'off',
      captureDom: mode !== 'off',
      maxDomNodes: 500,
      maxCandidates: 10,
      maxTextLength: 120,
      allowedAttributes: [
        'data-testid',
        'data-test',
        'id',
        'name',
        'aria-label',
        'placeholder',
        'title',
        'role',
        'type',
      ],
      registryMode: 'read',
      promotionMode: 'manual',
    },
    runBudget: {
      mode: 'warning_only',
      maxHealingAttempts: 25,
      maxFailureArtifacts: 50,
    },
  };
}

describe('captureFailureEvent', () => {
  afterEach(() => {
    resetTelemetryForTests();
  });

  it('returns null and does not write artifacts when self-heal mode is off', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: selfHealingConfig('off'),
      pageObjectName: 'ExamplePage',
      action: {
        type: 'type',
        target: '#username',
        description: 'Error typing in selector #username',
      },
      error: new Error('fill failed'),
      writer,
    });

    expect(result).toBeNull();
    expect(writer).not.toHaveBeenCalled();
  });

  it('captures and writes structured artifacts when mode is suggest', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();
    const fixedNow = new Date('2026-04-13T12:00:00.000Z');

    const result = await captureFailureEvent({
      config: selfHealingConfig('suggest'),
      pageObjectName: 'ExamplePage',
      currentUrl: 'https://example.test',
      screenshotPath: 'test-results/screenshots/failure.png',
      action: {
        type: 'type',
        target: '#username',
        description: 'Error typing in selector #username',
      },
      error: new Error('fill failed'),
      writer,
      env: {},
      now: () => fixedNow,
      randomSuffix: () => 'abc123',
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      mode: 'suggest',
      pageObjectName: 'ExamplePage',
      component: 'ExamplePage',
      runId: 'local-run',
      errorCode: 'page_action_error',
      currentUrl: 'https://example.test',
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: [],
      },
      action: {
        type: 'type',
        target: '#username',
        description: 'Error typing in selector #username',
      },
      error: {
        name: 'Error',
        message: 'fill failed',
      },
      artifactVersion: '1.0.0',
      screenshotPath: 'test-results/screenshots/failure.png',
      timestamp: fixedNow.toISOString(),
      eventId: '2026-04-13T12-00-00-000Z_abc123',
    });
    expect(result?.suggestions).toBeDefined();
    expect(result?.suggestions.length).toBeGreaterThan(0);
    expect(result?.suggestions[0]?.score).toBeGreaterThanOrEqual(
      result?.suggestions[1]?.score ?? 0,
    );
    expect(writer).toHaveBeenCalledTimes(1);
    expect(telemetry.spans[0]).toMatchObject({
      name: 'auroraflow.self_healing.capture',
      status: { code: 'ok' },
      attributes: expect.objectContaining({
        'auroraflow.self_heal.mode': 'suggest',
        'auroraflow.action.type': 'type',
        'auroraflow.page_object': 'ExamplePage',
        'auroraflow.action.target_kind': 'css',
        'auroraflow.run_id': 'local-run',
        'auroraflow.self_heal.artifact_written': true,
      }),
    });
    expect(telemetry.spans[0]?.attributes['auroraflow.action.target_hash']).toBeTypeOf('string');
    expect(Object.values(telemetry.spans[0]?.attributes ?? {})).not.toContain('#username');
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.selfHealingArtifactsTotal,
      value: 1,
      attributes: {
        'auroraflow.self_heal.mode': 'suggest',
        'auroraflow.action.type': 'type',
      },
    });
    expect(telemetry.counters).toContainEqual(
      expect.objectContaining({
        name: METRIC_NAMES.selfHealingSuggestionsTotal,
        value: 1,
        attributes: expect.objectContaining({
          'auroraflow.self_heal.strategy': expect.any(String) as string,
        }) as Record<string, string>,
      }),
    );
  });

  it('supports explicit correlation identifiers and error code', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: selfHealingConfig('suggest'),
      pageObjectName: 'ExamplePage',
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
      error: new Error('click failed'),
      writer,
      correlation: {
        runId: 'ci-run-101',
        testId: 'spec-5',
        component: 'CheckoutPage',
        errorCode: 'page_action_click_failed',
      },
    });

    expect(result).toMatchObject({
      runId: 'ci-run-101',
      testId: 'spec-5',
      component: 'CheckoutPage',
      errorCode: 'page_action_click_failed',
    });
  });

  it('writes default file artifacts to the directory declared by the capture env', async () => {
    const scope = await createVitestSelfHealingArtifactScope({
      prefix: 'failure-capture',
      runId: 'capture-run',
      testId: 'capture-test',
    });

    try {
      await captureFailureEvent({
        config: selfHealingConfig('suggest'),
        pageObjectName: 'ExamplePage',
        action: {
          type: 'click',
          target: '#submit',
          description: 'Error clicking selector #submit',
        },
        error: new Error('click failed'),
        env: scope.env,
        now: () => new Date('2026-06-16T00:00:00.000Z'),
        randomSuffix: () => 'scoped-output',
      });

      const artifact = await readSelfHealingArtifactFor<{
        action: { type: string };
        eventId: string;
        runId?: string;
        testId?: string;
      }>(scope);

      expect(artifact).toMatchObject({
        action: { type: 'click' },
        eventId: '2026-06-16T00-00-00-000Z_scoped-output',
        runId: 'capture-run',
        testId: 'capture-test',
      });
    } finally {
      await cleanupSelfHealingArtifactScope(scope);
    }
  });

  it('omits screenshot paths when the sensitive policy disables capture', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: selfHealingConfig('suggest'),
      pageObjectName: 'ExamplePage',
      screenshotPath: 'test-results/screenshots/private.png',
      privacyPolicy: SENSITIVE_ARTIFACT_PRIVACY_POLICY,
      action: {
        type: 'click',
        target: '#submit',
        description: 'Synthetic privacy fixture failure',
      },
      error: new Error('click failed'),
      writer,
    });

    expect(result?.screenshotPath).toBeUndefined();
    expect(writer).toHaveBeenCalledWith(
      expect.not.objectContaining({ screenshotPath: expect.any(String) as string }),
    );
  });

  it('falls back to GitHub and Playwright identifiers when AuroraFlow identifiers are absent', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: selfHealingConfig('suggest'),
      pageObjectName: 'ExamplePage',
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
      error: new Error('click failed'),
      writer,
      env: {
        GITHUB_RUN_ID: 'github-run-42',
        PLAYWRIGHT_TEST_ID: 'playwright-test-42',
      },
    });

    expect(result).toMatchObject({
      runId: 'github-run-42',
      testId: 'playwright-test-42',
    });
  });

  it('applies event decoration before persisting artifacts', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();
    const result = await captureFailureEvent({
      config: selfHealingConfig('guarded'),
      pageObjectName: 'ExamplePage',
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
      error: new Error('click failed'),
      writer,
      decorateEvent: async (event) => {
        event.guardedValidation = {
          mode: 'dry-run',
          actionType: 'click',
          minConfidence: 0.92,
          policy: {
            actionAllowed: true,
            domainAllowed: true,
            allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
            allowedDomains: ['example.test'],
          },
          acceptedLocator: "page.getByRole('button', { name: /submit/i })",
          acceptedScore: 0.93,
          candidates: [],
        };
        event.guardedAutoHeal = {
          attempted: true,
          succeeded: false,
          locator: "page.getByRole('button', { name: /submit/i })",
          errorMessage: 'guarded apply failed',
        };
      },
    });

    expect(result?.guardedValidation).toMatchObject({
      mode: 'dry-run',
      actionType: 'click',
      acceptedScore: 0.93,
    });
    expect(result?.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: false,
      errorMessage: 'guarded apply failed',
    });
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({
        guardedValidation: expect.objectContaining({
          mode: 'dry-run',
          actionType: 'click',
        }),
        guardedAutoHeal: expect.objectContaining({
          attempted: true,
          succeeded: false,
        }),
      }),
    );
  });
});
