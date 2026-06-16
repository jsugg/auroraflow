import { describe, expect, it } from 'vitest';
import { MemorySelectorStore } from '../../../../../src/data/selectors/memorySelectorStore';
import {
  SelectorRegistryRepository,
  type SelectorStoreJsonMergePatch,
  type SelectorStoreSetOptions,
} from '../../../../../src/data/selectors/selectorRegistry';
import { StoreSelectorCandidateHistoryRepository } from '../../../../../src/framework/selfHealing/historyRepository';
import { StorePendingSelectorPromotionRepository } from '../../../../../src/framework/selfHealing/promotionRepository';
import {
  createStoreSelfHealingRegistryRuntime,
  resolveSelfHealingRegistryRuntime,
} from '../../../../../src/framework/selfHealing/registryRuntime';
import type {
  RankedSelfHealingCandidate,
  SelfHealingConfig,
} from '../../../../../src/framework/selfHealing/types';
import { cleanupExpiredSelfHealingRegistryRecords } from '../../../../../scripts/self-healing-registry-cleanup';

class TrackingMemorySelectorStore extends MemorySelectorStore {
  public readonly ttlSecondsByKey = new Map<string, number | undefined>();

  public override async set(
    key: string,
    value: string,
    options?: SelectorStoreSetOptions,
  ): Promise<void> {
    await super.set(key, value, options);
    this.ttlSecondsByKey.set(key, options?.ttlSeconds);
  }

  public override async atomicJsonMerge(
    key: string,
    patch: SelectorStoreJsonMergePatch,
    options?: SelectorStoreSetOptions,
  ): Promise<string> {
    const serialized = await super.atomicJsonMerge(key, patch, options);
    this.ttlSecondsByKey.set(key, options?.ttlSeconds);
    return serialized;
  }

  public async rawSet(key: string, value: string): Promise<void> {
    await super.set(key, value);
  }
}

const rankedCandidate: RankedSelfHealingCandidate = {
  id: 'v2::CheckoutPage::click::candidate',
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
};

function selfHealingConfig(
  registryMode: SelfHealingConfig['sat']['registryMode'],
): SelfHealingConfig {
  return {
    mode: 'suggest',
    minConfidence: 0.92,
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

describe('self-healing registry runtime', () => {
  it('adapts selector registry and candidate history stores for SAT reads', async () => {
    const store = new TrackingMemorySelectorStore();
    const activeRegistry = new SelectorRegistryRepository({
      store,
      namespace: 'selector-registry',
      now: () => new Date('2026-06-08T12:00:00.000Z'),
    });
    await activeRegistry.upsert({
      id: 'checkout.submit',
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      locator: "page.getByTestId('submit-order')",
      confidence: 0.94,
    });
    await store.rawSet(
      'selector-history:v2::CheckoutPage::click::candidate',
      JSON.stringify({
        candidateId: 'v2::CheckoutPage::click::candidate',
        attempts: 3,
        validated: 2,
        guardedApplySucceeded: 1,
        guardedApplyFailed: 0,
        promoted: 0,
        rejected: 0,
        rolledBack: 0,
      }),
    );

    const runtime = createStoreSelfHealingRegistryRuntime({ store, required: true });

    await expect(runtime.selectors.get('checkout.submit')).resolves.toMatchObject({
      id: 'checkout.submit',
      version: 1,
    });
    await expect(
      runtime.selectors.findCandidates?.({
        pageObjectName: 'CheckoutPage',
        actionType: 'click',
        limit: 5,
      }),
    ).resolves.toHaveLength(1);
    const histories = await runtime.histories.getMany(['v2::CheckoutPage::click::candidate']);
    expect(histories.get('v2::CheckoutPage::click::candidate')).toMatchObject({
      attempts: 3,
      validated: 2,
    });
    expect(runtime.required).toBe(true);
  });

  it('keeps default read mode opportunistic until Redis is configured or required', () => {
    expect(resolveSelfHealingRegistryRuntime({}, selfHealingConfig('read'))).toBeUndefined();
    expect(
      resolveSelfHealingRegistryRuntime(
        {
          SELF_HEAL_REGISTRY_REQUIRED: 'true',
        },
        selfHealingConfig('read'),
      ),
    ).toBeDefined();
    expect(
      resolveSelfHealingRegistryRuntime(
        {
          AURORAFLOW_REDIS_URL: 'redis://127.0.0.1:6379/0',
        },
        selfHealingConfig('read'),
      ),
    ).toBeDefined();
    expect(
      resolveSelfHealingRegistryRuntime(
        {
          SELF_HEAL_REGISTRY_REQUIRED: 'true',
        },
        selfHealingConfig('off'),
      ),
    ).toBeUndefined();
  });

  it('records candidate history observations with TTL metadata', async () => {
    const store = new TrackingMemorySelectorStore();
    const repository = new StoreSelectorCandidateHistoryRepository({ store });

    const history = await repository.recordObservation({
      candidate: rankedCandidate,
      eventId: 'evt-001',
      observedAt: '2026-06-08T12:00:00.000Z',
      selectorId: 'checkout.submit',
      validationStatus: 'accepted',
      validationAccepted: true,
      guardedApplySucceeded: true,
    });

    expect(history).toMatchObject({
      candidateId: rankedCandidate.id,
      attempts: 1,
      validated: 1,
      guardedApplySucceeded: 1,
      guardedApplyFailed: 0,
      lastSeenAt: '2026-06-08T12:00:00.000Z',
      lastSuccessAt: '2026-06-08T12:00:00.000Z',
      expiresAt: '2026-07-08T12:00:00.000Z',
    });
    expect(store.ttlSecondsByKey.get(`selector-history:${rankedCandidate.id}`)).toBe(2_592_000);

    const secondHistory = await repository.recordObservation({
      candidate: rankedCandidate,
      eventId: 'evt-002',
      observedAt: '2026-06-08T12:01:00.000Z',
      selectorId: 'checkout.submit',
      validationStatus: 'no_matches',
      validationAccepted: false,
      guardedApplyFailed: true,
    });

    expect(secondHistory).toMatchObject({
      attempts: 2,
      validated: 1,
      guardedApplySucceeded: 1,
      guardedApplyFailed: 1,
    });
  });

  it('writes pending promotion records idempotently with expiry-aware TTL', async () => {
    const store = new TrackingMemorySelectorStore();
    const repository = new StorePendingSelectorPromotionRepository({ store });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const promotion = {
      promotionId: 'promotion:evt-001:candidate',
      eventId: 'evt-001',
      candidateId: rankedCandidate.id,
      selectorId: 'checkout.submit',
      proposedLocator: rankedCandidate.locator,
      locator: rankedCandidate.locator,
      baseSelectorVersion: 3,
      confidence: 0.96,
      status: 'pending' as const,
      requestedAt: '2026-06-08T12:00:00.000Z',
      expiresAt,
      runId: 'run-1',
      testId: 'spec-1',
      pageObjectName: 'CheckoutPage',
      actionType: 'click' as const,
      acknowledged: false,
    };

    await repository.upsert(promotion);
    await repository.upsert({ ...promotion, confidence: 0.97 });

    await expect(repository.get('evt-001')).resolves.toMatchObject({
      promotionId: 'promotion:evt-001:candidate',
      eventId: 'evt-001',
      candidateId: rankedCandidate.id,
      selectorId: 'checkout.submit',
      proposedLocator: rankedCandidate.locator,
      baseSelectorVersion: 3,
      confidence: 0.97,
      status: 'pending',
      acknowledged: false,
    });
    await expect(repository.list({ selectorId: 'checkout.submit' })).resolves.toHaveLength(1);
    expect(store.ttlSecondsByKey.get('selector-promotions:evt-001')).toBeGreaterThan(0);
  });

  it('cleanup removes only expired history and promotion records', async () => {
    const store = new TrackingMemorySelectorStore();
    await store.rawSet(
      'selector-history:expired',
      JSON.stringify({
        candidateId: 'expired',
        attempts: 1,
        validated: 0,
        guardedApplySucceeded: 0,
        guardedApplyFailed: 0,
        promoted: 0,
        rejected: 0,
        rolledBack: 0,
        expiresAt: '2026-06-08T11:59:00.000Z',
      }),
    );
    await store.rawSet(
      'selector-promotions:expired',
      JSON.stringify({
        promotionId: 'promotion:expired',
        eventId: 'evt-expired',
        candidateId: 'candidate',
        selectorId: 'checkout.submit',
        proposedLocator: rankedCandidate.locator,
        locator: rankedCandidate.locator,
        confidence: 0.95,
        status: 'pending',
        requestedAt: '2026-06-08T11:00:00.000Z',
        expiresAt: '2026-06-08T11:59:00.000Z',
        acknowledged: false,
      }),
    );
    await store.rawSet('selector-registry:checkout.submit', '{"id":"checkout.submit"}');

    const summary = await cleanupExpiredSelfHealingRegistryRecords({
      store,
      now: new Date('2026-06-08T12:00:00.000Z'),
    });

    expect(summary).toMatchObject({
      historyScanned: 1,
      historyDeleted: 1,
      promotionsScanned: 1,
      promotionsDeleted: 1,
      malformedRecords: 0,
    });
    await expect(store.get('selector-history:expired')).resolves.toBeNull();
    await expect(store.get('selector-promotions:expired')).resolves.toBeNull();
    await expect(store.get('selector-registry:checkout.submit')).resolves.toBe(
      '{"id":"checkout.submit"}',
    );
  });
});
