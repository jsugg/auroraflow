import { describe, expect, it } from 'vitest';
import {
  SelfHealingArtifactSchemaError,
  parseCapturedFailureEvent,
  parseDomSnapshot,
  parseSelectorCandidateHistory,
} from '../../../../../src/framework/selfHealing/artifactSchema';
import {
  parseCandidateLocator,
  parseLegacyLocatorString,
  textLocator,
} from '../../../../../src/framework/selfHealing/candidateLocator';

function baseFailureEvent(): Record<string, unknown> {
  return {
    artifactVersion: '1.0.0',
    eventId: 'self-heal-1',
    timestamp: '2026-06-05T12:00:00.000Z',
    runId: 'run-1',
    component: 'CheckoutPage',
    errorCode: 'page_action_error',
    mode: 'guarded',
    minConfidence: 0.92,
    safetyPolicy: { allowedActions: ['click'], allowedDomains: ['example.test'] },
    pageObjectName: 'CheckoutPage',
    action: { type: 'click', description: 'click submit' },
    error: { name: 'TimeoutError', message: 'timed out' },
  };
}

const suggestionSignals = {
  roleSignal: 0.2,
  accessibleNameSignal: 0.3,
  uniquenessSignal: 0.4,
  historicalSignal: 0,
  similaritySignal: 0.8,
};

describe('self-healing artifact schema parsers', () => {
  it('parses a valid DOM snapshot without widening unknown JSON', () => {
    const snapshot = parseDomSnapshot({
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-05T12:00:00.000Z',
      nodeCount: 1,
      truncated: false,
      elements: [
        {
          id: 'dom-1',
          tagName: 'button',
          attributes: {
            'data-testid': 'submit',
          },
          visible: true,
          enabled: true,
          editable: false,
          depth: 3,
          childCount: 0,
          cssPath: 'button#submit',
        },
      ],
    });

    expect(snapshot.elements[0]?.attributes['data-testid']).toBe('submit');
  });

  it('rejects malformed DOM snapshots with actionable schema errors', () => {
    expect(() =>
      parseDomSnapshot({
        schemaVersion: '1.0.0',
        capturedAt: '2026-06-05T12:00:00.000Z',
        nodeCount: -1,
        truncated: false,
        elements: [],
      }),
    ).toThrow(SelfHealingArtifactSchemaError);
  });

  it('parses selector candidate history counters', () => {
    const history = parseSelectorCandidateHistory({
      candidateId: 'CheckoutPage::click::target::testId::locator',
      attempts: 4,
      validated: 3,
      guardedApplySucceeded: 2,
      guardedApplyFailed: 1,
      promoted: 1,
      rejected: 0,
      rolledBack: 0,
      lastSeenAt: '2026-06-05T12:00:00.000Z',
    });

    expect(history).toMatchObject({
      attempts: 4,
      validated: 3,
      guardedApplySucceeded: 2,
      lastSeenAt: '2026-06-05T12:00:00.000Z',
    });
  });

  it('reads legacy failure events whose suggestions carry only string locators', () => {
    const event = parseCapturedFailureEvent({
      ...baseFailureEvent(),
      suggestions: [
        {
          locator: 'page.getByText("It\'s saved")',
          strategy: 'text',
          score: 0.9,
          rationale: 'legacy',
          signals: suggestionSignals,
        },
      ],
    });

    const [suggestion] = event.suggestions;
    expect(suggestion?.candidateLocator).toBeUndefined();
    // Legacy string read path reconstructs the structured locator on demand.
    expect(parseLegacyLocatorString(suggestion?.locator ?? '')).toEqual(textLocator("It's saved"));
  });

  it('reads new failure events whose suggestions carry structured locators', () => {
    const event = parseCapturedFailureEvent({
      ...baseFailureEvent(),
      suggestions: [
        {
          locator: "page.getByText('It\\'s saved')",
          strategy: 'text',
          score: 0.9,
          rationale: 'structured',
          signals: suggestionSignals,
          candidateLocator: { schemaVersion: '1.0.0', kind: 'text', value: "It's saved" },
        },
      ],
    });

    const [suggestion] = event.suggestions;
    expect(parseCandidateLocator(suggestion?.candidateLocator)).toEqual(textLocator("It's saved"));
  });
});
