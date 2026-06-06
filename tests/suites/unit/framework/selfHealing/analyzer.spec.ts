import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { analyzeSelfHealingFailure } from '../../../../../src/framework/selfHealing/analyzer';
import type {
  DomSnapshot,
  SelfHealingConfig,
} from '../../../../../src/framework/selfHealing/types';

function selfHealingConfig(overrides: Partial<SelfHealingConfig['sat']> = {}): SelfHealingConfig {
  return {
    mode: 'suggest',
    minConfidence: 0.92,
    safetyPolicy: {
      allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
      allowedDomains: [],
    },
    sat: {
      enabled: true,
      captureDom: true,
      maxDomNodes: 500,
      maxCandidates: 10,
      maxTextLength: 120,
      allowedAttributes: ['data-testid', 'id', 'role', 'aria-label', 'type'],
      registryMode: 'read',
      promotionMode: 'manual',
      ...overrides,
    },
  };
}

const snapshot = {
  schemaVersion: '1.0.0',
  capturedAt: '2026-06-05T12:00:00.000Z',
  url: 'https://example.test/checkout',
  nodeCount: 1,
  truncated: false,
  elements: [
    {
      id: 'dom-1',
      tagName: 'button',
      attributes: {
        'data-testid': 'submit-order',
        id: 'submit',
      },
      role: 'button',
      accessibleName: 'Submit order',
      text: 'Submit order',
      visible: true,
      enabled: true,
      editable: false,
      depth: 3,
      childCount: 0,
      cssPath: 'button#submit',
    },
  ],
} satisfies DomSnapshot;

describe('analyzeSelfHealingFailure', () => {
  it('enriches suggest-mode failures with SAT snapshot summary and ranked candidates', async () => {
    const page = {
      evaluate: vi
        .fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>()
        .mockResolvedValue(snapshot),
    } as unknown as Page;

    const result = await analyzeSelfHealingFailure({
      page,
      config: selfHealingConfig(),
      pageObjectName: 'CheckoutPage',
      currentUrl: snapshot.url,
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
    });

    expect(result.sat).toMatchObject({
      schemaVersion: '1.0.0',
      enabled: true,
      snapshot: {
        nodeCount: 1,
        elementCount: 1,
        truncated: false,
      },
    });
    expect(result.sat?.candidates.some((candidate) => candidate.strategy === 'testId')).toBe(true);
    expect(result.sat?.selectedCandidateId).toBe(result.sat?.candidates[0]?.id);
  });

  it('does not capture DOM when SAT is explicitly disabled', async () => {
    const evaluate = vi.fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>();
    const page = { evaluate } as unknown as Page;

    const result = await analyzeSelfHealingFailure({
      page,
      config: selfHealingConfig({ enabled: false, captureDom: false }),
      pageObjectName: 'CheckoutPage',
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
    });

    expect(result.sat).toEqual({
      schemaVersion: '1.0.0',
      enabled: false,
      candidates: [],
      history: {
        enabled: false,
        observations: 0,
        loadedCandidates: 0,
        warnings: [],
      },
      analysisWarnings: [],
    });
    expect(evaluate).not.toHaveBeenCalled();
  });
});
