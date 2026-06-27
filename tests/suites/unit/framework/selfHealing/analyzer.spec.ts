import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import { analyzeSelfHealingFailure } from '../../../../../src/framework/selfHealing/analyzer';
import { buildSelfHealingCandidateId } from '../../../../../src/framework/selfHealing/candidateScoring';
import { SENSITIVE_ARTIFACT_PRIVACY_POLICY } from '../../../../../src/framework/selfHealing/artifactPrivacy';
import type { SelfHealingRegistryRuntime } from '../../../../../src/framework/selfHealing/registryContracts';
import type {
  DomSnapshot,
  SelectorCandidateHistory,
  SelfHealingConfig,
} from '../../../../../src/framework/selfHealing/types';
import {
  SYNTHETIC_SECRET,
  createSyntheticSecretDomSnapshot,
} from '../../../../fixtures/privacy/syntheticSecrets';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

function selfHealingConfig(overrides: Partial<SelfHealingConfig['sat']> = {}): SelfHealingConfig {
  return {
    mode: 'suggest',
    minConfidence: 0.92,
    safetyPolicy: {
      allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
      allowedDomains: [],
    },
    sat: {
      enabled: true,
      captureDom: true,
      maxDomNodes: 500,
      maxCandidates: 10,
      maxTextLength: 120,
      allowedAttributes: ['data-testid', 'id', 'role', 'aria-label', 'type'],
      registryMode: 'read',
      promotionMode: 'manual',
      ...overrides,
    },
    runBudget: {
      mode: 'warning_only',
      maxHealingAttempts: 25,
      maxFailureArtifacts: 50,
    },
  };
}

const snapshot = {
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
        id: 'submit',
      },
      role: 'button',
      accessibleName: 'Submit order',
      text: 'Submit order',
      visible: true,
      enabled: true,
      editable: false,
      depth: 3,
      childCount: 0,
      cssPath: 'button#submit',
    },
  ],
} satisfies DomSnapshot;

describe('analyzeSelfHealingFailure', () => {
  it('enriches suggest-mode failures with SAT snapshot summary and ranked candidates', async () => {
    const telemetry = new CapturingTelemetry();
    const timestamps = [10, 14];
    const page = {
      evaluate: vi
        .fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>()
        .mockResolvedValue(snapshot),
    } as unknown as Page;

    const result = await analyzeSelfHealingFailure({
      page,
      config: selfHealingConfig(),
      pageObjectName: 'CheckoutPage',
      currentUrl: snapshot.url,
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
      telemetry,
      now: () => timestamps.shift() ?? 14,
    });

    expect(result.sat).toMatchObject({
      schemaVersion: '1.0.0',
      enabled: true,
      snapshot: {
        nodeCount: 1,
        elementCount: 1,
        truncated: false,
      },
    });
    expect(result.sat?.candidates.some((candidate) => candidate.strategy === 'testId')).toBe(true);
    expect(result.sat?.selectedCandidateId).toBe(result.sat?.candidates[0]?.id);
    expect(telemetry.histograms).toContainEqual({
      name: METRIC_NAMES.selfHealingDomSnapshotDurationMs,
      value: 4,
      attributes: {
        'auroraflow.self_heal.mode': 'suggest',
        'auroraflow.self_heal.operation': 'dom_snapshot',
        'auroraflow.self_heal.status': 'succeeded',
        'auroraflow.action.type': 'click',
        'auroraflow.page_object': 'CheckoutPage',
      },
    });
  });

  it('does not capture DOM when SAT is explicitly disabled', async () => {
    const evaluate = vi.fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>();
    const page = { evaluate } as unknown as Page;

    const result = await analyzeSelfHealingFailure({
      page,
      config: selfHealingConfig({ enabled: false, captureDom: false }),
      pageObjectName: 'CheckoutPage',
      action: {
        type: 'click',
        target: '#submit',
        description: 'Error clicking selector #submit',
      },
    });

    expect(result.sat).toEqual({
      schemaVersion: '1.0.0',
      enabled: false,
      candidates: [],
      history: {
        enabled: false,
        observations: 0,
        loadedCandidates: 0,
        warnings: [],
      },
      analysisWarnings: [],
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('does not build text-derived candidates from sensitive DOM content', async () => {
    const secretSnapshot = createSyntheticSecretDomSnapshot();
    const page = {
      evaluate: vi
        .fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>()
        .mockResolvedValue(secretSnapshot),
    } as unknown as Page;

    const result = await analyzeSelfHealingFailure({
      page,
      config: selfHealingConfig(),
      pageObjectName: 'PrivacyPage',
      currentUrl: secretSnapshot.url,
      privacyPolicy: SENSITIVE_ARTIFACT_PRIVACY_POLICY,
      action: {
        type: 'click',
        target: '#submit',
        description: 'Synthetic privacy fixture failure',
      },
    });

    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_SECRET);
    const domCandidates = result.sat?.candidates.filter(
      (candidate) => candidate.evidence.source === 'dom',
    );
    expect(domCandidates).not.toHaveLength(0);
    expect(
      domCandidates?.every(
        (candidate) => !['ariaLabel', 'roleName', 'text'].includes(candidate.strategy),
      ),
    ).toBe(true);
  });

  it('loads active registry selectors and applies candidate history to ranking', async () => {
    const page = {} as unknown as Page;
    const locator = "page.getByTestId('submit-order')";
    const candidateId = buildSelfHealingCandidateId({
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      failedTarget: '#submit',
      selectorId: 'checkout.submit',
      strategy: 'registry',
      locator,
    });
    const history: SelectorCandidateHistory = {
      candidateId,
      attempts: 6,
      validated: 4,
      guardedApplySucceeded: 3,
      guardedApplyFailed: 0,
      promoted: 1,
      rejected: 0,
      rolledBack: 0,
      lastSeenAt: '2026-06-08T12:00:00.000Z',
      lastSuccessAt: '2026-06-08T12:00:00.000Z',
    };
    const record = {
      id: 'checkout.submit',
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      locator,
      confidence: 0.96,
      updatedAt: '2026-06-08T12:00:00.000Z',
      version: 3,
    };
    const recordObservation = vi.fn(async () => history);
    const upsertPromotion = vi.fn(async (promotion) => promotion);
    const runtime: SelfHealingRegistryRuntime = {
      selectors: {
        get: vi.fn().mockResolvedValue(record),
        findCandidates: vi.fn().mockResolvedValue([record]),
      },
      histories: {
        get: vi.fn().mockResolvedValue(history),
        getMany: vi.fn().mockImplementation(async (candidateIds: readonly string[]) => {
          const histories = new Map<string, SelectorCandidateHistory>();
          if (candidateIds.includes(candidateId)) {
            histories.set(candidateId, history);
          }
          return histories;
        }),
        recordObservation,
      },
      promotions: {
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        upsert: upsertPromotion,
      },
      required: false,
    };

    const result = await analyzeSelfHealingFailure({
      page,
      config: selfHealingConfig({ captureDom: false }),
      pageObjectName: 'CheckoutPage',
      currentUrl: snapshot.url,
      action: {
        type: 'click',
        target: '#submit',
        selectorId: 'checkout.submit',
        description: 'Error clicking selector #submit',
      },
      registryRuntime: runtime,
    });

    expect(runtime.selectors.get).toHaveBeenCalledWith('checkout.submit');
    expect(runtime.histories.getMany).toHaveBeenCalledWith(expect.arrayContaining([candidateId]));
    expect(recordObservation).not.toHaveBeenCalled();
    expect(upsertPromotion).not.toHaveBeenCalled();
    expect(result.sat?.history).toMatchObject({
      enabled: true,
      loadedCandidates: 1,
      observations: 6,
      warnings: [],
    });

    const registryCandidate = result.sat?.candidates.find(
      (candidate) => candidate.registryRecordId === 'checkout.submit',
    );
    expect(registryCandidate).toMatchObject({
      id: candidateId,
      locator,
      strategy: 'registry',
      registryRecordVersion: 3,
      evidence: {
        source: 'registry',
      },
      history: {
        enabled: true,
        observations: 6,
      },
    });
    expect(registryCandidate?.signals.historicalSignal).toBeGreaterThan(0.5);
    expect(result.sat?.selectedCandidateId).toBe(result.sat?.candidates[0]?.id);
  });

  it('surfaces registry read warnings when read mode lacks a runtime', async () => {
    const result = await analyzeSelfHealingFailure({
      page: {} as unknown as Page,
      config: selfHealingConfig({ captureDom: false }),
      pageObjectName: 'CheckoutPage',
      currentUrl: snapshot.url,
      action: {
        type: 'click',
        target: '#submit',
        selectorId: 'checkout.submit',
        description: 'Error clicking selector #submit',
      },
    });

    expect(result.sat?.history).toMatchObject({
      enabled: true,
      loadedCandidates: 0,
      observations: 0,
      warnings: [
        'Self-healing registry read mode is enabled, but no registry runtime is configured.',
      ],
    });
    expect(result.sat?.analysisWarnings).toContain(
      'Self-healing registry read mode is enabled, but no registry runtime is configured.',
    );
  });
});
