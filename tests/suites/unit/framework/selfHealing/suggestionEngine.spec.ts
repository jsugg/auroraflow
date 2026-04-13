import { describe, expect, it } from 'vitest';
import { generateRankedLocatorSuggestions } from '../../../../../src/framework/selfHealing/suggestionEngine';

describe('generateRankedLocatorSuggestions', () => {
  it('prefers accessibility-oriented candidates for common click selectors', () => {
    const suggestions = generateRankedLocatorSuggestions({
      actionType: 'click',
      failedTarget: '#joinOurTeamButton',
    });

    expect(suggestions).not.toHaveLength(0);
    expect(suggestions[0]?.score).toBeGreaterThanOrEqual(suggestions[1]?.score ?? 0);
    expect(suggestions.some((item) => item.strategy === 'roleName')).toBe(true);
    expect(suggestions.some((item) => item.strategy === 'testId')).toBe(true);
  });

  it('uses historical success rates as a ranking signal', () => {
    const preferredLocator = "page.getByRole('button', { name: /joinourteambutton/i })";
    const suggestions = generateRankedLocatorSuggestions({
      actionType: 'click',
      failedTarget: '#joinOurTeamButton',
      historicalSuccessByLocator: {
        [preferredLocator]: 1,
      },
    });

    expect(suggestions[0]?.locator).toBe(preferredLocator);
  });

  it('returns deterministic, score-bounded fallback suggestions for unknown targets', () => {
    const first = generateRankedLocatorSuggestions({
      actionType: 'type',
      failedTarget: undefined,
    });
    const second = generateRankedLocatorSuggestions({
      actionType: 'type',
      failedTarget: undefined,
    });

    expect(first).toEqual(second);
    expect(first).not.toHaveLength(0);
    for (const suggestion of first) {
      expect(suggestion.score).toBeGreaterThanOrEqual(0);
      expect(suggestion.score).toBeLessThanOrEqual(1);
    }
  });
});
