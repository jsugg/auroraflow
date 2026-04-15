import { describe, expect, it, vi } from 'vitest';
import { captureFailureEvent } from '../../../../../src/framework/selfHealing/failureCapture';

describe('captureFailureEvent', () => {
  it('returns null and does not write artifacts when self-heal mode is off', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: {
        mode: 'off',
        minConfidence: 0.92,
        safetyPolicy: {
          allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
          allowedDomains: [],
        },
      },
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
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();
    const fixedNow = new Date('2026-04-13T12:00:00.000Z');

    const result = await captureFailureEvent({
      config: {
        mode: 'suggest',
        minConfidence: 0.92,
        safetyPolicy: {
          allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
          allowedDomains: [],
        },
      },
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
  });

  it('supports explicit correlation identifiers and error code', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: {
        mode: 'suggest',
        minConfidence: 0.92,
        safetyPolicy: {
          allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
          allowedDomains: [],
        },
      },
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

  it('falls back to GitHub and Playwright identifiers when AuroraFlow identifiers are absent', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: {
        mode: 'suggest',
        minConfidence: 0.92,
        safetyPolicy: {
          allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
          allowedDomains: [],
        },
      },
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
      config: {
        mode: 'guarded',
        minConfidence: 0.92,
        safetyPolicy: {
          allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
          allowedDomains: ['example.test'],
        },
      },
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
