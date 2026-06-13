import type { DomSnapshot } from '../../../src/framework/selfHealing/types';

export const SYNTHETIC_SECRET = 'synthetic-only-secret-value-42';

export function createSyntheticSecretDomSnapshot(): DomSnapshot {
  return {
    schemaVersion: '1.0.0',
    capturedAt: '2026-06-12T12:00:00.000Z',
    url: 'https://example.test/privacy-fixture',
    nodeCount: 1,
    truncated: false,
    elements: [
      {
        id: 'dom-1',
        tagName: 'button',
        attributes: {
          'data-testid': 'submit-private-form',
          'aria-label': SYNTHETIC_SECRET,
          title: SYNTHETIC_SECRET,
        },
        role: 'button',
        accessibleName: SYNTHETIC_SECRET,
        text: SYNTHETIC_SECRET,
        visible: true,
        enabled: true,
        editable: false,
        depth: 2,
        childCount: 0,
        cssPath: 'button[data-testid="submit-private-form"]',
      },
    ],
  };
}
