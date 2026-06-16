import { describe, expect, it, type TestContext } from 'vitest';
import type { SelectorStore } from '../../src/data/selectors/selectorRegistry';

export interface SelectorStoreConformanceHandle {
  store: SelectorStore;
  advanceTime?: (milliseconds: number) => void;
  cleanup?: () => Promise<void> | void;
}

export interface SelectorStoreConformanceOptions {
  create: (
    context: TestContext,
  ) => Promise<SelectorStoreConformanceHandle> | SelectorStoreConformanceHandle;
}

let keyCounter = 0;

export function defineSelectorStoreConformanceSuite(
  suiteName: string,
  options: SelectorStoreConformanceOptions,
): void {
  describe(`${suiteName} SelectorStore conformance`, () => {
    it('round-trips get, getMany, set, and del', async (context) => {
      await withStore(context, options, async ({ store, key }) => {
        await store.set(key('alpha'), 'value-a');
        await store.set(key('beta'), 'value-b');

        expect(await store.get(key('alpha'))).toBe('value-a');
        expect(await requireGetMany(store)([key('alpha'), key('beta'), key('missing')])).toEqual([
          'value-a',
          'value-b',
          null,
        ]);
        expect(await store.del(key('alpha'))).toBe(1);
        expect(await store.del(key('alpha'))).toBe(0);
        expect(await store.get(key('alpha'))).toBeNull();
      });
    });

    it('lists matching keys through keys and scanKeys in deterministic order', async (context) => {
      await withStore(context, options, async ({ store, key, scope }) => {
        await store.set(key('b'), 'value-b');
        await store.set(key('a'), 'value-a');
        await store.set(`outside:${scope}:other`, 'value-other');

        expect(await store.keys(key('*'))).toEqual([key('a'), key('b')]);

        const scanned: string[] = [];
        for await (const matchedKey of requireScanKeys(store)(key('*'))) {
          scanned.push(matchedKey);
        }
        expect(scanned.sort((left, right) => left.localeCompare(right))).toEqual([
          key('a'),
          key('b'),
        ]);
      });
    });

    it('expires TTL records and removes TTL on overwrite without TTL', async (context) => {
      await withStore(context, options, async ({ store, key, expire }) => {
        await store.set(key('ttl'), 'temporary', { ttlSeconds: 1 });
        expect(await store.get(key('ttl'))).toBe('temporary');
        await expire();
        expect(await store.get(key('ttl'))).toBeNull();

        await store.set(key('overwrite'), 'temporary', { ttlSeconds: 1 });
        await store.set(key('overwrite'), 'durable');
        await expire();
        expect(await store.get(key('overwrite'))).toBe('durable');
      });
    });

    it('rejects invalid TTLs consistently', async (context) => {
      for (const ttlSeconds of [0, -1, 1.5, Number.NaN, 2_592_001]) {
        await withStore(context, options, async ({ store, key }) => {
          await expect(store.set(key('invalid-ttl'), 'value', { ttlSeconds })).rejects.toThrow(
            /ttlSeconds/,
          );
          await expect(
            requireCompareAndSet(store)(key('invalid-cas-ttl'), '{"version":1}', {
              expectedVersion: null,
              ttlSeconds,
            }),
          ).rejects.toThrow(/ttlSeconds/);
          await expect(
            requireAtomicJsonMerge(store)(
              key('invalid-merge-ttl'),
              { defaultValue: { attempts: 0 } },
              { ttlSeconds },
            ),
          ).rejects.toThrow(/ttlSeconds/);
        });
      }
    });

    it('performs sequential and concurrent compare-and-set writes', async (context) => {
      await withStore(context, options, async ({ store, key }) => {
        const compareAndSet = requireCompareAndSet(store);

        await expect(
          compareAndSet(key('cas'), JSON.stringify({ version: 1, value: 'created' }), {
            expectedVersion: null,
          }),
        ).resolves.toMatchObject({ written: true, existingValue: null });

        await expect(
          compareAndSet(key('cas'), JSON.stringify({ version: 2, value: 'stale' }), {
            expectedVersion: null,
          }),
        ).resolves.toMatchObject({ written: false });

        const concurrent = await Promise.all([
          compareAndSet(key('cas'), JSON.stringify({ version: 2, value: 'winner-a' }), {
            expectedVersion: 1,
          }),
          compareAndSet(key('cas'), JSON.stringify({ version: 2, value: 'winner-b' }), {
            expectedVersion: 1,
          }),
        ]);
        expect(concurrent.filter((result) => result.written)).toHaveLength(1);

        const stored = await store.get(key('cas'));
        expect(stored === null ? null : JSON.parse(stored)).toMatchObject({ version: 2 });
      });
    });

    it('atomically merges JSON default values, counters, and set fields', async (context) => {
      await withStore(context, options, async ({ store, key }) => {
        const atomicJsonMerge = requireAtomicJsonMerge(store);

        await atomicJsonMerge(key('merge'), {
          defaultValue: { attempts: 0, selectorId: 'checkout.submit' },
          increments: { attempts: 1 },
          set: { lastStatus: 'accepted' },
        });
        const merged = await atomicJsonMerge(key('merge'), {
          defaultValue: { attempts: 0, selectorId: 'ignored.default' },
          increments: { attempts: 2, failed: 1 },
          set: { lastStatus: 'failed' },
        });

        expect(JSON.parse(merged)).toMatchObject({
          attempts: 3,
          failed: 1,
          selectorId: 'checkout.submit',
          lastStatus: 'failed',
        });
      });
    });
  });
}

interface ScopedStore {
  store: SelectorStore;
  key: (suffix: string) => string;
  scope: string;
  expire: () => Promise<void>;
}

async function withStore(
  context: TestContext,
  options: SelectorStoreConformanceOptions,
  run: (scopedStore: ScopedStore) => Promise<void>,
): Promise<void> {
  const handle = await options.create(context);
  const scope = `conformance:${Date.now()}:${keyCounter}`;
  keyCounter += 1;
  const key = (suffix: string): string => `${scope}:${suffix}`;
  const expire = async (): Promise<void> => {
    if (handle.advanceTime) {
      handle.advanceTime(1_001);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  };

  try {
    await run({ store: handle.store, key, scope, expire });
  } finally {
    await handle.cleanup?.();
  }
}

function requireGetMany(
  store: SelectorStore,
): (keys: readonly string[]) => Promise<Array<string | null>> {
  if (!store.getMany) {
    throw new Error('SelectorStore.getMany is required by the conformance suite.');
  }
  return (keys) => store.getMany?.(keys) ?? Promise.resolve([]);
}

function requireCompareAndSet(store: SelectorStore): NonNullable<SelectorStore['compareAndSet']> {
  if (!store.compareAndSet) {
    throw new Error('SelectorStore.compareAndSet is required by the conformance suite.');
  }
  return store.compareAndSet.bind(store);
}

function requireAtomicJsonMerge(
  store: SelectorStore,
): NonNullable<SelectorStore['atomicJsonMerge']> {
  if (!store.atomicJsonMerge) {
    throw new Error('SelectorStore.atomicJsonMerge is required by the conformance suite.');
  }
  return store.atomicJsonMerge.bind(store);
}

function requireScanKeys(store: SelectorStore): NonNullable<SelectorStore['scanKeys']> {
  if (!store.scanKeys) {
    throw new Error('SelectorStore.scanKeys is required by the conformance suite.');
  }
  return store.scanKeys.bind(store);
}
