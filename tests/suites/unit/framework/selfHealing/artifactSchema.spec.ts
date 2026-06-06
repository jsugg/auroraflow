import { describe, expect, it } from 'vitest';
import {
  SelfHealingArtifactSchemaError,
  parseDomSnapshot,
  parseSelectorCandidateHistory,
} from '../../../../../src/framework/selfHealing/artifactSchema';

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
      lastSeenAt: '2026-06-05T12:00:00.000Z',
    });

    expect(history).toMatchObject({
      attempts: 4,
      validated: 3,
      guardedApplySucceeded: 2,
      lastSeenAt: '2026-06-05T12:00:00.000Z',
    });
  });
});
