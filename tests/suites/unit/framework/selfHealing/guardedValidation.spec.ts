import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { DEFAULT_SELF_HEAL_MIN_CONFIDENCE } from '../../../../../src/framework/selfHealing/config';
import {
  evaluateGuardedSuggestionsDryRun,
  resolveLocatorExpression,
} from '../../../../../src/framework/selfHealing/guardedValidation';
import type { SelfHealingSuggestion } from '../../../../../src/framework/selfHealing/types';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

type LocatorState = {
  count: number;
  visible: boolean;
};

type LocatorMock = {
  count: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
};

type GuardedPageMock = {
  frameLocator: ReturnType<typeof vi.fn>;
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
    frameLocator: vi.fn().mockReturnValue({
      getByTestId: vi.fn().mockReturnValue(createLocatorMock(acceptedState)),
    }),
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
  afterEach(() => {
    resetTelemetryForTests();
  });

  it('accepts the first confidence-eligible visible candidate and records reasons for skipped candidates', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
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
    expect(telemetry.spans[0]).toMatchObject({
      name: 'auroraflow.self_healing.guarded_validation',
      status: { code: 'ok' },
      attributes: expect.objectContaining({
        'auroraflow.self_heal.mode': 'dry-run',
        'auroraflow.action.type': 'click',
        'auroraflow.self_heal.min_confidence': 0.5,
        'auroraflow.self_heal.candidate_count': 3,
        'auroraflow.self_heal.accepted': true,
        'auroraflow.self_heal.accepted_locator_strategy': 'roleName',
      }),
    });
    expect(telemetry.spans[0]?.attributes['auroraflow.current_url_hash']).toBeTypeOf('string');
    expect(Object.values(telemetry.spans[0]?.attributes ?? {})).not.toContain(
      'https://example.test/page',
    );
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedValidationCandidatesTotal,
      value: 1,
      attributes: {
        'auroraflow.self_heal.status': 'accepted',
        'auroraflow.self_heal.strategy': 'roleName',
      },
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedValidationCandidatesTotal,
      value: 1,
      attributes: {
        'auroraflow.self_heal.status': 'below_confidence_threshold',
        'auroraflow.self_heal.strategy': 'text',
      },
    });
  });

  it('keeps default guarded validation registry-curated by confidence', async () => {
    const pageMock = createGuardedPageMock();
    const freshDomScore = DEFAULT_SELF_HEAL_MIN_CONFIDENCE - 0.001;
    const curatedRegistryScore = DEFAULT_SELF_HEAL_MIN_CONFIDENCE + 0.001;
    const suggestions: SelfHealingSuggestion[] = [
      createSuggestion("page.getByRole('button', { name: /submit/i })", freshDomScore, 'roleName'),
      createSuggestion("page.getByTestId('submit')", curatedRegistryScore, 'registry'),
    ];

    const result = await evaluateGuardedSuggestionsDryRun({
      page: pageMock as unknown as Page,
      actionType: 'click',
      minConfidence: DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
      suggestions,
      currentUrl: 'https://example.test/page',
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: ['example.test'],
      },
    });

    expect(result.acceptedLocator).toBe("page.getByTestId('submit')");
    expect(result.acceptedScore).toBe(curatedRegistryScore);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: "page.getByTestId('submit')",
          strategy: 'registry',
          status: 'accepted',
          confidenceEligible: true,
        }),
        expect.objectContaining({
          locator: "page.getByRole('button', { name: /submit/i })",
          strategy: 'roleName',
          status: 'below_confidence_threshold',
          confidenceEligible: false,
          matchedElements: 0,
        }),
      ]),
    );
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
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
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
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'auroraflow.self_heal.accepted': false,
      'auroraflow.self_heal.policy_blocked_reason': 'action_not_allowed',
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.guardedValidationCandidatesTotal,
      value: 1,
      attributes: {
        'auroraflow.self_heal.status': 'action_not_allowed',
        'auroraflow.self_heal.strategy': 'none',
      },
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

describe('resolveLocatorExpression AUR-IMPL-020 regression safety net', () => {
  it.each([
    {
      expression: 'page.getByText("It\'s saved")',
      expectedMethod: 'getByText',
      expectedArgument: "It's saved",
    },
    {
      expression: "page.getByText('It\\'s saved')",
      expectedMethod: 'getByText',
      expectedArgument: "It's saved",
    },
    {
      expression: "page.getByText('It's saved')",
      expectedMethod: 'getByText',
      expectedArgument: "It's saved",
    },
    {
      expression: 'page.getByLabel("Customer email")',
      expectedMethod: 'getByLabel',
      expectedArgument: 'Customer email',
    },
    {
      expression: 'page.locator("button[aria-label=\\"Save changes\\"]")',
      expectedMethod: 'locator',
      expectedArgument: 'button[aria-label="Save changes"]',
    },
  ] as const)(
    'parses quoted $expectedMethod expression $expression before structured candidates',
    ({ expression, expectedMethod, expectedArgument }) => {
      const pageMock = createGuardedPageMock();

      const locator = resolveLocatorExpression(pageMock as unknown as Page, expression);

      expect(locator).not.toBeNull();
      expect(pageMock[expectedMethod]).toHaveBeenCalledWith(expectedArgument);
    },
  );

  it('parses role/name candidates with quoted strings and regular expressions', () => {
    const pageMock = createGuardedPageMock();

    const stringNameLocator = resolveLocatorExpression(
      pageMock as unknown as Page,
      'page.getByRole("button", { name: "Save changes" })',
    );
    const regexNameLocator = resolveLocatorExpression(
      pageMock as unknown as Page,
      "page.getByRole('button', { name: /save changes/i })",
    );

    expect(stringNameLocator).not.toBeNull();
    expect(regexNameLocator).not.toBeNull();
    expect(pageMock.getByRole).toHaveBeenNthCalledWith(1, 'button', { name: 'Save changes' });
    expect(pageMock.getByRole).toHaveBeenNthCalledWith(2, 'button', { name: /save changes/i });
  });

  it.fails('documents AUR-QE-112 gap for same-origin frame test-id candidates', () => {
    const pageMock = createGuardedPageMock();

    const locator = resolveLocatorExpression(
      pageMock as unknown as Page,
      "page.frameLocator('iframe[title=\"Checkout iframe\"]').getByTestId('iframe-submit')",
    );

    expect(locator).not.toBeNull();
    expect(pageMock.frameLocator).toHaveBeenCalledWith('iframe[title="Checkout iframe"]');
    expect(pageMock.frameLocator.mock.results[0]?.value.getByTestId).toHaveBeenCalledWith(
      'iframe-submit',
    );
  });
});
