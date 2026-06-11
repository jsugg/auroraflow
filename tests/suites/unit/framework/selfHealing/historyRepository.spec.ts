import { describe, expect, it } from 'vitest';
import type {
  SelectorStore,
  SelectorStoreSetOptions,
} from '../../../../../src/data/selectors/selectorRegistry';
import {
  DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS,
  StoreSelectorCandidateHistoryRepository,
} from '../../../../../src/framework/selfHealing/historyRepository';
import type { RankedSelfHealingCandidate } from '../../../../../src/framework/selfHealing/types';

type JsonPrimitive = string | number | boolean | null;
type JsonObject = Record<string, JsonPrimitive>;

interface AtomicJsonMergePatch {
  defaultValue: Readonly<JsonObject>;
  increments?: Readonly<Record<string, number>>;
  set?: Readonly<JsonObject>;
}

class AtomicInMemorySelectorStore implements SelectorStore {
  private readonly records = new Map<string, string>();
  public readonly ttlSecondsByKey = new Map<string, number | undefined>();

  public async get(key: string): Promise<string | null> {
    return this.records.get(key) ?? null;
  }

  public async getMany(keys: readonly string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.records.get(key) ?? null);
  }

  public async set(key: string, value: string, options?: SelectorStoreSetOptions): Promise<void> {
    this.records.set(key, value);
    this.ttlSecondsByKey.set(key, options?.ttlSeconds);
  }

  public async atomicJsonMerge(
    key: string,
    patch: AtomicJsonMergePatch,
    options?: SelectorStoreSetOptions,
  ): Promise<string> {
    const current = this.records.get(key);
    const record = current === undefined ? { ...patch.defaultValue } : parseJsonObject(current);

    for (const [fieldName, value] of Object.entries(patch.defaultValue)) {
      record[fieldName] ??= value;
    }
    for (const [fieldName, increment] of Object.entries(patch.increments ?? {})) {
      const currentValue = record[fieldName];
      record[fieldName] = (typeof currentValue === 'number' ? currentValue : 0) + increment;
    }
    for (const [fieldName, value] of Object.entries(patch.set ?? {})) {
      record[fieldName] = value;
    }

    const serialized = JSON.stringify(record);
    this.records.set(key, serialized);
    this.ttlSecondsByKey.set(key, options?.ttlSeconds);
    return serialized;
  }

  public async del(key: string): Promise<number> {
    return this.records.delete(key) ? 1 : 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    const matcher = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return [...this.records.keys()].filter((key) => matcher.test(key));
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

function parseJsonObject(serialized: string): JsonObject {
  const parsed = JSON.parse(serialized) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('stored history must be a JSON object.');
  }

  const record: JsonObject = {};
  for (const [fieldName, value] of Object.entries(parsed)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      record[fieldName] = value;
      continue;
    }

    throw new Error(`stored history field ${fieldName} must be a JSON primitive.`);
  }

  return record;
}

describe('StoreSelectorCandidateHistoryRepository', () => {
  it('uses a 30-day default TTL for shortest useful retention', async () => {
    const store = new AtomicInMemorySelectorStore();
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
    const store = new AtomicInMemorySelectorStore();
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
    const store = new AtomicInMemorySelectorStore();
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
    const store = new AtomicInMemorySelectorStore();

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
    const store = new AtomicInMemorySelectorStore();
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
