import { afterEach, describe, expect, it } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { generateRankedLocatorSuggestions } from '../../../../../src/framework/selfHealing/suggestionEngine';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

describe('generateRankedLocatorSuggestions', () => {
  afterEach(() => {
    resetTelemetryForTests();
  });

  it('prefers accessibility-oriented candidates for common click selectors', () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    const suggestions = generateRankedLocatorSuggestions({
      actionType: 'click',
      failedTarget: '#joinOurTeamButton',
    });

    expect(suggestions).not.toHaveLength(0);
    expect(suggestions[0]?.score).toBeGreaterThanOrEqual(suggestions[1]?.score ?? 0);
    expect(suggestions.some((item) => item.strategy === 'roleName')).toBe(true);
    expect(suggestions.some((item) => item.strategy === 'testId')).toBe(true);
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.selfHealingSuggestionsTotal,
      value: 1,
      attributes: {
        'auroraflow.self_heal.strategy': 'roleName',
      },
    });
    expect(telemetry.counters).toHaveLength(suggestions.length);
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

  it('extracts selector hints from adversarial strings without regex backtracking', () => {
    const suggestions = generateRankedLocatorSuggestions({
      actionType: 'click',
      failedTarget: `[data-testid='submit-order'] text=${' '.repeat(2_048)}Submit`,
      maxCandidates: 10,
    });

    expect(suggestions.map((suggestion) => suggestion.locator)).toEqual(
      expect.arrayContaining(["page.getByTestId('submit-order')", "page.getByText('Submit')"]),
    );
  });
});
