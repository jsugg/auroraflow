import { describe, expect, it } from 'vitest';
import {
  buildSelfHealingCandidateId,
  rankSelfHealingCandidates,
} from '../../../../../src/framework/selfHealing/candidateScoring';
import type { SelfHealingCandidateSeed } from '../../../../../src/framework/selfHealing/candidateTypes';
import type { SelectorCandidateHistory } from '../../../../../src/framework/selfHealing/types';

describe('rankSelfHealingCandidates', () => {
  it('prefers visible unique test-id evidence over CSS fallbacks', () => {
    const domCandidates: SelfHealingCandidateSeed[] = [
      {
        locator: "page.locator('button.primary')",
        strategy: 'cssFallback',
        rationale: 'CSS fallback.',
        evidence: {
          elementId: 'dom-1',
          source: 'dom',
          uniqueInSnapshot: true,
          visible: true,
          matchedAttributes: ['cssPath'],
        },
      },
      {
        locator: "page.getByTestId('submit-order')",
        strategy: 'testId',
        rationale: 'Stable test id.',
        evidence: {
          elementId: 'dom-1',
          source: 'dom',
          uniqueInSnapshot: true,
          visible: true,
          accessibleName: 'Submit order',
          role: 'button',
          matchedAttributes: ['data-testid'],
        },
      },
    ];

    const ranked = rankSelfHealingCandidates({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#submit',
      heuristicSuggestions: [],
      domCandidates,
      maxCandidates: 10,
    });

    expect(ranked[0]).toMatchObject({
      locator: "page.getByTestId('submit-order')",
      strategy: 'testId',
      evidence: {
        source: 'dom',
        uniqueInSnapshot: true,
      },
    });
    for (const candidate of ranked) {
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
    }
  });

  it('builds deterministic candidate IDs from stable hashes', () => {
    const first = buildSelfHealingCandidateId({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#submit',
      strategy: 'testId',
      locator: "page.getByTestId('submit-order')",
    });
    const second = buildSelfHealingCandidateId({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#submit',
      strategy: 'testId',
      locator: "page.getByTestId('submit-order')",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^CheckoutPage::click::[a-f0-9]{12}::testId::[a-f0-9]{12}$/);
  });

  it('builds stable v2 candidate IDs when selector IDs are available', () => {
    const candidateId = buildSelfHealingCandidateId({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#submit',
      selectorId: 'checkout.submit',
      strategy: 'registry',
      locator: "page.getByTestId('submit-order')",
    });

    expect(candidateId).toMatch(/^v2::CheckoutPage::click::[a-f0-9]{12}::registry::[a-f0-9]{12}$/);
  });

  it('adds registry-backed candidates and history-aware ranking signals', () => {
    const locator = "page.getByTestId('submit-order')";
    const candidateId = buildSelfHealingCandidateId({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#legacy-submit',
      selectorId: 'checkout.submit',
      strategy: 'registry',
      locator,
    });
    const history: SelectorCandidateHistory = {
      candidateId,
      attempts: 8,
      validated: 5,
      guardedApplySucceeded: 4,
      guardedApplyFailed: 0,
      promoted: 1,
      rejected: 0,
    };

    const ranked = rankSelfHealingCandidates({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#legacy-submit',
      selectorId: 'checkout.submit',
      heuristicSuggestions: [],
      domCandidates: [],
      registryCandidates: [
        {
          id: 'checkout.submit',
          pageObjectName: 'CheckoutPage',
          actionType: 'click',
          locator,
          confidence: 0.94,
          updatedAt: '2026-06-08T12:00:00.000Z',
          version: 2,
        },
      ],
      candidateHistories: new Map([[candidateId, history]]),
      maxCandidates: 10,
    });

    expect(ranked[0]).toMatchObject({
      id: candidateId,
      locator,
      strategy: 'registry',
      registryRecordId: 'checkout.submit',
      registryRecordVersion: 2,
      evidence: {
        source: 'registry',
      },
      history: {
        enabled: true,
        observations: 8,
        loadedCandidates: 1,
      },
    });
    expect(ranked[0]?.signals.historicalSignal).toBeGreaterThan(0.5);
  });
});
