import { describe, expect, it } from 'vitest';
import {
  buildSelfHealingCandidateId,
  rankSelfHealingCandidates,
} from '../../../../../src/framework/selfHealing/candidateScoring';
import type { SelfHealingCandidateSeed } from '../../../../../src/framework/selfHealing/candidateTypes';

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
});
