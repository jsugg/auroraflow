import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMA_FILES,
  ArtifactSchemaValidationError,
  createArtifactSchemaValidator,
  type ArtifactSchemaFile,
} from '../../../../../scripts/schemas-check';

const validatorPromise = createArtifactSchemaValidator();

function suggestionSignals(): Record<string, number> {
  return {
    roleSignal: 0.2,
    accessibleNameSignal: 0.3,
    uniquenessSignal: 0.4,
    historicalSignal: 0,
    similaritySignal: 0.8,
  };
}

async function expectSchemaValid(schemaFile: ArtifactSchemaFile, payload: unknown): Promise<void> {
  const validator = await validatorPromise;
  validator.validate(schemaFile, payload);
}

describe('self-healing artifact JSON Schemas', () => {
  it('validates current DOM snapshot artifacts', async () => {
    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.domSnapshot, {
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-05T12:00:00.000Z',
      url: 'https://example.test/checkout',
      nodeCount: 1,
      truncated: false,
      elements: [
        {
          id: 'dom-1',
          tagName: 'button',
          attributes: {
            'data-testid': 'submit-order',
          },
          role: 'button',
          accessibleName: 'Submit order',
          visible: true,
          enabled: true,
          editable: false,
          depth: 3,
          childCount: 0,
          cssPath: 'main > button',
        },
      ],
    });
  });

  it('validates self-healing failure events with SAT and guarded summaries', async () => {
    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.selfHealingFailureEvent, {
      artifactVersion: '1.0.0',
      eventId: 'self-heal-2026-06-05T12-00-00-000Z-abc',
      timestamp: '2026-06-05T12:00:00.000Z',
      runId: 'run-1',
      testId: 'checkout submits',
      component: 'CheckoutPage',
      errorCode: 'page_action_error',
      mode: 'guarded',
      minConfidence: 0.92,
      safetyPolicy: {
        allowedActions: ['click'],
        allowedDomains: ['example.test'],
      },
      pageObjectName: 'CheckoutPage',
      currentUrl: 'https://example.test/checkout',
      screenshotPath: 'test-results/screenshots/checkout.png',
      action: {
        type: 'click',
        target: '[data-testid="submit-order"]',
        selectorId: 'checkout.submit',
        description: 'click submit order',
      },
      error: {
        name: 'TimeoutError',
        message: 'locator timed out',
        stack: 'TimeoutError: locator timed out',
      },
      suggestions: [
        {
          locator: 'getByRole("button", { name: "Submit order" })',
          strategy: 'roleName',
          score: 0.94,
          rationale: 'Role/name candidate matched failed action context.',
          signals: suggestionSignals(),
        },
      ],
      sat: {
        schemaVersion: '1.0.0',
        enabled: true,
        snapshot: {
          schemaVersion: '1.0.0',
          capturedAt: '2026-06-05T12:00:00.000Z',
          url: 'https://example.test/checkout',
          nodeCount: 1,
          truncated: false,
          elementCount: 1,
        },
        candidates: [
          {
            id: 'CheckoutPage::click::submit::roleName',
            locator: 'getByRole("button", { name: "Submit order" })',
            strategy: 'roleName',
            score: 0.94,
            rationale: 'Role/name candidate matched failed action context.',
            signals: suggestionSignals(),
            evidence: {
              source: 'dom',
              uniqueInSnapshot: true,
              visible: true,
              role: 'button',
              accessibleName: 'Submit order',
              matchedAttributes: ['role', 'accessibleName'],
            },
          },
        ],
        history: {
          enabled: false,
          loadedCandidates: 0,
          observations: [],
          warnings: ['registry history is not wired yet'],
        },
        selectedCandidateId: 'CheckoutPage::click::submit::roleName',
        analysisWarnings: [],
      },
      guardedValidation: {
        mode: 'dry-run',
        actionType: 'click',
        minConfidence: 0.92,
        policy: {
          actionAllowed: true,
          domainAllowed: true,
          evaluatedDomain: 'example.test',
          allowedActions: ['click'],
          allowedDomains: ['example.test'],
        },
        acceptedLocator: 'getByRole("button", { name: "Submit order" })',
        acceptedScore: 0.94,
        candidates: [
          {
            locator: 'getByRole("button", { name: "Submit order" })',
            strategy: 'roleName',
            score: 0.94,
            confidenceEligible: true,
            matchedElements: 1,
            visible: true,
            enabled: true,
            stable: true,
            semanticMatch: true,
            status: 'accepted',
          },
        ],
      },
      guardedAutoHeal: {
        attempted: true,
        succeeded: true,
        locator: 'getByRole("button", { name: "Submit order" })',
      },
    });
  });

  it('validates selector history and pending promotion contracts', async () => {
    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.selectorCandidateHistory, {
      candidateId: 'CheckoutPage::click::submit::roleName',
      attempts: 4,
      validated: 3,
      guardedApplySucceeded: 2,
      guardedApplyFailed: 1,
      promoted: 1,
      rejected: 0,
      lastSeenAt: '2026-06-05T12:00:00.000Z',
      lastSuccessAt: '2026-06-05T12:00:00.000Z',
    });

    await expectSchemaValid(ARTIFACT_SCHEMA_FILES.pendingSelectorPromotion, {
      eventId: 'self-heal-2026-06-05T12-00-00-000Z-abc',
      candidateId: 'CheckoutPage::click::submit::roleName',
      selectorId: 'checkout.submit',
      locator: 'getByRole("button", { name: "Submit order" })',
      requestedAt: '2026-06-05T12:00:00.000Z',
      acknowledged: false,
    });
  });

  it('rejects malformed artifacts with actionable diagnostics', async () => {
    const validator = await validatorPromise;

    expect(() =>
      validator.validate(ARTIFACT_SCHEMA_FILES.domSnapshot, {
        schemaVersion: '1.0.0',
        capturedAt: '2026-06-05T12:00:00.000Z',
        nodeCount: -1,
        truncated: false,
        elements: [],
      }),
    ).toThrow(ArtifactSchemaValidationError);
    expect(() =>
      validator.validate(ARTIFACT_SCHEMA_FILES.domSnapshot, {
        schemaVersion: '1.0.0',
        capturedAt: '2026-06-05T12:00:00.000Z',
        nodeCount: -1,
        truncated: false,
        elements: [],
      }),
    ).toThrow('/nodeCount');
  });
});
