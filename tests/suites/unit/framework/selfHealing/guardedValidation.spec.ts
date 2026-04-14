import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { evaluateGuardedSuggestionsDryRun } from '../../../../../src/framework/selfHealing/guardedValidation';
import type { SelfHealingSuggestion } from '../../../../../src/framework/selfHealing/types';

type LocatorState = {
  count: number;
  visible: boolean;
};

type LocatorMock = {
  count: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
};

type GuardedPageMock = {
  getByLabel: ReturnType<typeof vi.fn>;
  getByRole: ReturnType<typeof vi.fn>;
  getByTestId: ReturnType<typeof vi.fn>;
  getByText: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
};

function createLocatorMock(state: LocatorState): LocatorMock {
  return {
    count: vi.fn().mockResolvedValue(state.count),
    first: vi.fn().mockReturnValue({
      isVisible: vi.fn().mockResolvedValue(state.visible),
    }),
  };
}

function createGuardedPageMock(overrides: Partial<LocatorState> = {}): GuardedPageMock {
  const acceptedState = {
    count: overrides.count ?? 1,
    visible: overrides.visible ?? true,
  };

  return {
    getByLabel: vi.fn().mockReturnValue(createLocatorMock({ count: 0, visible: false })),
    getByRole: vi.fn().mockReturnValue(createLocatorMock(acceptedState)),
    getByTestId: vi.fn().mockReturnValue(createLocatorMock(acceptedState)),
    getByText: vi.fn().mockReturnValue(createLocatorMock({ count: 0, visible: false })),
    locator: vi.fn().mockReturnValue(createLocatorMock({ count: 0, visible: false })),
  };
}

function createSuggestion(
  locator: string,
  score: number,
  strategy: SelfHealingSuggestion['strategy'],
): SelfHealingSuggestion {
  return {
    locator,
    strategy,
    score,
    rationale: 'test',
    signals: {
      roleSignal: 1,
      accessibleNameSignal: 1,
      uniquenessSignal: 1,
      historicalSignal: 1,
      similaritySignal: 1,
    },
  };
}

describe('evaluateGuardedSuggestionsDryRun', () => {
  it('accepts the first confidence-eligible visible candidate and records reasons for skipped candidates', async () => {
    const pageMock = createGuardedPageMock();
    const suggestions: SelfHealingSuggestion[] = [
      createSuggestion("page.getByRole('button', { name: /submit/i })", 0.93, 'roleName'),
      createSuggestion("page.getByTestId('submit')", 0.72, 'testId'),
      createSuggestion("page.getByText('Submit')", 0.2, 'text'),
    ];

    const result = await evaluateGuardedSuggestionsDryRun({
      page: pageMock as unknown as Page,
      actionType: 'click',
      minConfidence: 0.5,
      suggestions,
      currentUrl: 'https://example.test/page',
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: ['example.test'],
      },
    });

    expect(result.mode).toBe('dry-run');
    expect(result.policy).toMatchObject({
      actionAllowed: true,
      domainAllowed: true,
      evaluatedDomain: 'example.test',
    });
    expect(result.acceptedLocator).toBe("page.getByRole('button', { name: /submit/i })");
    expect(result.acceptedScore).toBe(0.93);
    expect(result.candidates[0]).toMatchObject({
      locator: "page.getByRole('button', { name: /submit/i })",
      status: 'accepted',
      confidenceEligible: true,
      matchedElements: 1,
      visible: true,
    });
    expect(result.candidates[2]).toMatchObject({
      locator: "page.getByText('Submit')",
      status: 'below_confidence_threshold',
      confidenceEligible: false,
    });
  });

  it('marks unsupported locator expressions without throwing', async () => {
    const pageMock = createGuardedPageMock();
    const suggestions: SelfHealingSuggestion[] = [
      createSuggestion("customResolver('submit')", 0.91, 'fallback'),
    ];

    const result = await evaluateGuardedSuggestionsDryRun({
      page: pageMock as unknown as Page,
      actionType: 'click',
      minConfidence: 0.5,
      suggestions,
      currentUrl: 'https://example.test/page',
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: [],
      },
    });

    expect(result.acceptedLocator).toBeUndefined();
    expect(result.candidates).toEqual([
      expect.objectContaining({
        locator: "customResolver('submit')",
        status: 'unsupported_locator_expression',
        confidenceEligible: true,
        matchedElements: 0,
        visible: false,
      }),
    ]);
  });

  it('blocks guarded validation when action type is not allowed by policy', async () => {
    const pageMock = createGuardedPageMock();
    const suggestions: SelfHealingSuggestion[] = [
      createSuggestion("page.getByRole('button', { name: /submit/i })", 0.93, 'roleName'),
    ];

    const result = await evaluateGuardedSuggestionsDryRun({
      page: pageMock as unknown as Page,
      actionType: 'close',
      minConfidence: 0.5,
      suggestions,
      currentUrl: 'https://example.test/page',
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: ['example.test'],
      },
    });

    expect(result.acceptedLocator).toBeUndefined();
    expect(result.candidates).toEqual([]);
    expect(result.policy).toMatchObject({
      actionAllowed: false,
      domainAllowed: false,
      blockedReason: 'action_not_allowed',
    });
  });

  it('blocks guarded validation when current domain is outside allow-list', async () => {
    const pageMock = createGuardedPageMock();
    const suggestions: SelfHealingSuggestion[] = [
      createSuggestion("page.getByRole('button', { name: /submit/i })", 0.93, 'roleName'),
    ];

    const result = await evaluateGuardedSuggestionsDryRun({
      page: pageMock as unknown as Page,
      actionType: 'click',
      minConfidence: 0.5,
      suggestions,
      currentUrl: 'https://blocked.test/page',
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: ['example.test'],
      },
    });

    expect(result.acceptedLocator).toBeUndefined();
    expect(result.candidates).toEqual([]);
    expect(result.policy).toMatchObject({
      actionAllowed: true,
      domainAllowed: false,
      evaluatedDomain: 'blocked.test',
      blockedReason: 'domain_not_allowed',
    });
  });
});
