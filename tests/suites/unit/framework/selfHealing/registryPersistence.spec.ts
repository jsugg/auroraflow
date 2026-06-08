import { describe, expect, it, vi, afterEach } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import { persistSelfHealingRegistryTelemetry } from '../../../../../src/framework/selfHealing/registryPersistence';
import type { SelfHealingRegistryRuntime } from '../../../../../src/framework/selfHealing/registryContracts';
import type {
  CapturedFailureEvent,
  RankedSelfHealingCandidate,
  SelfHealingConfig,
} from '../../../../../src/framework/selfHealing/types';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

function selfHealingConfig(
  registryMode: SelfHealingConfig['sat']['registryMode'] = 'write_pending',
): SelfHealingConfig {
  return {
    mode: 'guarded',
    minConfidence: 0.3,
    safetyPolicy: {
      allowedActions: ['click'],
      allowedDomains: [],
    },
    sat: {
      enabled: true,
      captureDom: false,
      maxDomNodes: 500,
      maxCandidates: 10,
      maxTextLength: 120,
      allowedAttributes: ['data-testid'],
      registryMode,
      promotionMode: 'manual',
    },
  };
}

function rankedCandidate(
  overrides: Partial<RankedSelfHealingCandidate>,
): RankedSelfHealingCandidate {
  return {
    id: 'candidate-new',
    locator: "page.getByRole('button', { name: 'Submit order' })",
    strategy: 'roleName',
    score: 0.96,
    rationale: 'Role/name candidate matched.',
    signals: {
      roleSignal: 1,
      accessibleNameSignal: 1,
      uniquenessSignal: 1,
      historicalSignal: 0,
      similaritySignal: 0.5,
    },
    evidence: {
      source: 'heuristic',
      uniqueInSnapshot: true,
      visible: true,
      matchedAttributes: [],
    },
    ...overrides,
  };
}

function failureEvent(): CapturedFailureEvent {
  const accepted = rankedCandidate({});
  const active = rankedCandidate({
    id: 'candidate-active',
    locator: '#legacy-submit',
    strategy: 'registry',
    score: 0.4,
    registryRecordId: 'checkout.submit',
    registryRecordVersion: 7,
    evidence: {
      source: 'registry',
      uniqueInSnapshot: false,
      visible: true,
      matchedAttributes: [],
    },
  });

  return {
    artifactVersion: '1.0.0',
    eventId: 'evt-001',
    timestamp: '2026-06-08T12:00:00.000Z',
    runId: 'run-1',
    testId: 'spec-1',
    component: 'CheckoutPage',
    errorCode: 'page_action_click_failed',
    mode: 'guarded',
    minConfidence: 0.3,
    safetyPolicy: {
      allowedActions: ['click'],
      allowedDomains: [],
    },
    pageObjectName: 'CheckoutPage',
    action: {
      type: 'click',
      target: '#legacy-submit',
      selectorId: 'checkout.submit',
      description: 'Error clicking submit.',
    },
    error: {
      name: 'Error',
      message: 'click failed',
    },
    suggestions: [],
    sat: {
      schemaVersion: '1.0.0',
      enabled: true,
      candidates: [accepted, active],
      history: {
        enabled: true,
        observations: 0,
        loadedCandidates: 0,
        warnings: [],
      },
      selectedCandidateId: accepted.id,
      analysisWarnings: [],
    },
    guardedValidation: {
      mode: 'dry-run',
      actionType: 'click',
      minConfidence: 0.3,
      acceptedLocator: accepted.locator,
      acceptedScore: accepted.score,
      policy: {
        actionAllowed: true,
        domainAllowed: true,
        allowedActions: ['click'],
        allowedDomains: [],
      },
      candidates: [
        {
          locator: accepted.locator,
          strategy: accepted.strategy,
          score: accepted.score,
          confidenceEligible: true,
          matchedElements: 1,
          visible: true,
          status: 'accepted',
        },
        {
          locator: active.locator,
          strategy: active.strategy,
          score: active.score,
          confidenceEligible: true,
          matchedElements: 1,
          visible: true,
          status: 'no_matches',
        },
      ],
    },
    guardedAutoHeal: {
      attempted: true,
      succeeded: true,
      locator: accepted.locator,
    },
  };
}

function runtime(overrides: Partial<SelfHealingRegistryRuntime> = {}): SelfHealingRegistryRuntime {
  return {
    selectors: {
      get: vi.fn().mockResolvedValue(null),
      findCandidates: vi.fn().mockResolvedValue([]),
    },
    histories: {
      get: vi.fn().mockResolvedValue(null),
      getMany: vi.fn().mockResolvedValue(new Map()),
      recordObservation: vi.fn().mockResolvedValue({
        candidateId: 'candidate-new',
        attempts: 1,
        validated: 1,
        guardedApplySucceeded: 1,
        guardedApplyFailed: 0,
        promoted: 0,
        rejected: 0,
      }),
    },
    promotions: {
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(async (promotion) => promotion),
    },
    required: false,
    ...overrides,
  };
}

describe('self-healing registry persistence', () => {
  afterEach(() => {
    resetTelemetryForTests();
  });

  it('records history observations and an idempotent pending promotion in write-pending mode', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    const registryRuntime = runtime();

    const summary = await persistSelfHealingRegistryTelemetry({
      config: selfHealingConfig(),
      event: failureEvent(),
      registryRuntime,
    });

    expect(registryRuntime.histories.recordObservation).toHaveBeenCalledTimes(2);
    expect(registryRuntime.histories.recordObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-001',
        selectorId: 'checkout.submit',
        validationStatus: 'accepted',
        validationAccepted: true,
        guardedApplySucceeded: true,
      }),
    );
    expect(registryRuntime.promotions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionId: expect.stringMatching(/^promotion:evt-001:/) as string,
        eventId: 'evt-001',
        candidateId: 'candidate-new',
        selectorId: 'checkout.submit',
        proposedLocator: "page.getByRole('button', { name: 'Submit order' })",
        baseSelectorVersion: 7,
        status: 'pending',
        acknowledged: false,
      }),
    );
    expect(summary).toMatchObject({
      mode: 'write_pending',
      history: {
        attempted: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
      },
      promotion: {
        status: 'succeeded',
        eventId: 'evt-001',
        candidateId: 'candidate-new',
        selectorId: 'checkout.submit',
      },
      warnings: [],
    });
    expect(telemetry.counters).toContainEqual(
      expect.objectContaining({
        name: METRIC_NAMES.selfHealingRegistryWritesTotal,
        attributes: expect.objectContaining({
          'auroraflow.self_heal.registry.operation': 'pending_promotion',
          'auroraflow.self_heal.status': 'succeeded',
        }) as Record<string, unknown>,
      }),
    );
  });

  it('surfaces history and promotion write failures in the summary', async () => {
    const registryRuntime = runtime({
      histories: {
        get: vi.fn().mockResolvedValue(null),
        getMany: vi.fn().mockResolvedValue(new Map()),
        recordObservation: vi.fn().mockRejectedValue(new Error('history down')),
      },
      promotions: {
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockRejectedValue(new Error('promotion down')),
      },
    });

    const summary = await persistSelfHealingRegistryTelemetry({
      config: selfHealingConfig(),
      event: failureEvent(),
      registryRuntime,
    });

    expect(summary.history.failed).toBe(2);
    expect(summary.promotion).toMatchObject({
      status: 'failed',
      errorMessage: 'promotion down',
    });
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Candidate history write failed') as string,
        expect.stringContaining('Pending promotion write failed') as string,
      ]),
    );
  });

  it('does not write in read mode', async () => {
    const registryRuntime = runtime();

    const summary = await persistSelfHealingRegistryTelemetry({
      config: selfHealingConfig('read'),
      event: failureEvent(),
      registryRuntime,
    });

    expect(registryRuntime.histories.recordObservation).not.toHaveBeenCalled();
    expect(registryRuntime.promotions.upsert).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      mode: 'read',
      history: {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 2,
      },
      promotion: {
        status: 'skipped',
        reason: 'registry_mode_not_write_pending',
      },
    });
  });
});
