import { describe, expect, it } from 'vitest';
import { extractDomCandidateSeeds } from '../../../../../src/framework/selfHealing/domCandidateExtraction';
import type { DomSnapshot } from '../../../../../src/framework/selfHealing/types';

const snapshot: DomSnapshot = {
  schemaVersion: '1.0.0',
  capturedAt: '2026-06-05T12:00:00.000Z',
  url: 'https://example.test',
  nodeCount: 3,
  truncated: false,
  elements: [
    {
      id: 'dom-1',
      tagName: 'button',
      attributes: {
        'data-testid': 'submit-order',
        id: 'submit',
        type: 'button',
      },
      role: 'button',
      accessibleName: 'Submit order',
      text: 'Submit order',
      visible: true,
      enabled: true,
      editable: false,
      depth: 4,
      childCount: 0,
      cssPath: 'button#submit',
    },
    {
      id: 'dom-2',
      tagName: 'p',
      attributes: {},
      text: 'button',
      visible: true,
      enabled: true,
      editable: false,
      depth: 4,
      childCount: 0,
      cssPath: 'p.helper',
    },
  ],
};

describe('extractDomCandidateSeeds', () => {
  it('extracts stable DOM-backed candidates and filters generic text', () => {
    const candidates = extractDomCandidateSeeds({
      snapshot,
      actionType: 'click',
      maxTextLength: 120,
    });

    expect(candidates.map((candidate) => candidate.locator)).toEqual(
      expect.arrayContaining([
        "page.getByTestId('submit-order')",
        "page.getByRole('button', { name: 'Submit order' })",
        "page.getByText('Submit order')",
        "page.locator('button#submit')",
      ]),
    );
    expect(candidates.some((candidate) => candidate.locator === "page.getByText('button')")).toBe(
      false,
    );
    expect(
      candidates.find((candidate) => candidate.locator === "page.getByTestId('submit-order')")
        ?.evidence.uniqueInSnapshot,
    ).toBe(true);
  });
});
