import { describe, expect, it } from 'vitest';
import { MemorySelectorStore } from '../../../../../src/data/selectors/memorySelectorStore';
import type {
  SelectorStore,
  SelectorStoreJsonMergePatch,
  SelectorStoreSetOptions,
} from '../../../../../src/data/selectors/selectorRegistry';
import {
  DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS,
  StoreSelectorCandidateHistoryRepository,
} from '../../../../../src/framework/selfHealing/historyRepository';
import type { RankedSelfHealingCandidate } from '../../../../../src/framework/selfHealing/types';

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
}

const rankedCandidate: RankedSelfHealingCandidate = {
  id: 'v2::CheckoutPage::click::history-candidate',
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

describe('StoreSelectorCandidateHistoryRepository', () => {
  it('uses a 30-day default TTL for shortest useful retention', async () => {
    const store = new TrackingMemorySelectorStore();
    const repository = new StoreSelectorCandidateHistoryRepository({ store });

    const history = await repository.recordObservation({
      candidate: rankedCandidate,
      eventId: 'evt-default-ttl',
      observedAt: '2026-06-08T12:00:00.000Z',
      selectorId: 'checkout.submit',
      validationStatus: 'accepted',
      validationAccepted: true,
      guardedApplySucceeded: true,
    });

    expect(DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS).toBe(2_592_000);
    expect(history.expiresAt).toBe('2026-07-08T12:00:00.000Z');
    expect(store.ttlSecondsByKey.get(`selector-history:${rankedCandidate.id}`)).toBe(2_592_000);
  });

  it('honors custom positive TTLs below the retention cap', async () => {
    const store = new TrackingMemorySelectorStore();
    const repository = new StoreSelectorCandidateHistoryRepository({ store, ttlSeconds: 3_600 });

    const history = await repository.recordObservation({
      candidate: rankedCandidate,
      eventId: 'evt-custom-ttl',
      observedAt: '2026-06-08T12:00:00.000Z',
      selectorId: 'checkout.submit',
      validationStatus: 'accepted',
      validationAccepted: true,
    });

    expect(history.expiresAt).toBe('2026-06-08T13:00:00.000Z');
    expect(store.ttlSecondsByKey.get(`selector-history:${rankedCandidate.id}`)).toBe(3_600);
  });

  it('clamps custom TTLs above 30 days to the retention cap', async () => {
    const store = new TrackingMemorySelectorStore();
    const repository = new StoreSelectorCandidateHistoryRepository({
      store,
      ttlSeconds: DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS + 1,
    });

    const history = await repository.recordObservation({
      candidate: rankedCandidate,
      eventId: 'evt-clamped-ttl',
      observedAt: '2026-06-08T12:00:00.000Z',
      selectorId: 'checkout.submit',
      validationStatus: 'accepted',
      validationAccepted: true,
    });

    expect(history.expiresAt).toBe('2026-07-08T12:00:00.000Z');
    expect(store.ttlSecondsByKey.get(`selector-history:${rankedCandidate.id}`)).toBe(2_592_000);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid TTL %s', (ttlSeconds) => {
    const store = new TrackingMemorySelectorStore();

    expect(() => new StoreSelectorCandidateHistoryRepository({ store, ttlSeconds })).toThrow(
      'selector history ttlSeconds must be a positive integer.',
    );
  });

  it('fails writes explicitly when the store lacks atomic merge support', async () => {
    const legacyStore: SelectorStore = {
      get: async () => null,
      getMany: async (keys) => keys.map(() => null),
      set: async () => undefined,
      del: async () => 0,
      keys: async () => [],
    };
    const repository = new StoreSelectorCandidateHistoryRepository({ store: legacyStore });

    await expect(
      repository.recordObservation({
        candidate: rankedCandidate,
        eventId: 'evt-legacy-store',
        observedAt: '2026-06-08T12:00:00.000Z',
        selectorId: 'checkout.submit',
        validationStatus: 'accepted',
        validationAccepted: true,
      }),
    ).rejects.toThrow(
      'SelectorStore.atomicJsonMerge is required for atomic candidate history writes.',
    );
    await expect(
      repository.recordOutcome({
        candidateId: rankedCandidate.id,
        observedAt: '2026-06-08T12:00:00.000Z',
        promoted: 1,
      }),
    ).rejects.toThrow(
      'SelectorStore.atomicJsonMerge is required for atomic candidate history writes.',
    );
  });

  it('preserves exact observation counters under parallel writes', async () => {
    const store = new TrackingMemorySelectorStore();
    const repository = new StoreSelectorCandidateHistoryRepository({ store });
    const observationCount = 128;

    await Promise.all(
      Array.from({ length: observationCount }, async (_, index) =>
        repository.recordObservation({
          candidate: rankedCandidate,
          eventId: `evt-concurrent-${index}`,
          observedAt: '2026-06-08T12:00:00.000Z',
          selectorId: 'checkout.submit',
          validationStatus: index % 2 === 0 ? 'accepted' : 'no_matches',
          validationAccepted: index % 2 === 0,
          guardedApplySucceeded: index % 3 === 0,
          guardedApplyFailed: index % 5 === 0,
        }),
      ),
    );

    await expect(repository.get(rankedCandidate.id)).resolves.toMatchObject({
      candidateId: rankedCandidate.id,
      attempts: observationCount,
      validated: 64,
      guardedApplySucceeded: 43,
      guardedApplyFailed: 26,
      lastSeenAt: '2026-06-08T12:00:00.000Z',
      lastSuccessAt: '2026-06-08T12:00:00.000Z',
      expiresAt: '2026-07-08T12:00:00.000Z',
    });
  });
});
