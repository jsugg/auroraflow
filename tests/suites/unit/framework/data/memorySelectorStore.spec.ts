import { describe, expect, it } from 'vitest';
import {
  MemorySelectorStore,
  createMemorySelectorStore,
} from '../../../../../src/data/selectors/memorySelectorStore';
import { defineSelectorStoreConformanceSuite } from '../../../../helpers/selectorStoreConformance';

defineSelectorStoreConformanceSuite('MemorySelectorStore', {
  create: () => {
    let nowMs = Date.parse('2026-06-16T00:00:00.000Z');
    const store = createMemorySelectorStore({ now: () => nowMs });
    return {
      store,
      advanceTime: (milliseconds: number): void => {
        nowMs += milliseconds;
      },
      cleanup: () => store.close(),
    };
  },
});

describe('MemorySelectorStore lifecycle', () => {
  it('advertises non-durable storage and clears records explicitly', async () => {
    const store = createMemorySelectorStore();

    expect(store).toBeInstanceOf(MemorySelectorStore);
    expect(store.durability).toBe('non-durable');

    await store.set('local:key', 'value');
    expect(await store.get('local:key')).toBe('value');
    store.clear();
    expect(await store.get('local:key')).toBeNull();
  });

  it('makes close idempotent and rejects later operations', async () => {
    const store = createMemorySelectorStore();

    await store.set('local:key', 'value');
    await store.close();
    await store.close();

    await expect(store.get('local:key')).rejects.toThrow('Memory selector store is closed.');
  });

  it('compares and sets JSON records by field value atomically', async () => {
    const store = createMemorySelectorStore();
    await store.set('local:promotion', JSON.stringify({ status: 'pending', value: 1 }));

    await expect(
      store.compareAndSetJsonField('local:promotion', JSON.stringify({ status: 'applied' }), {
        fieldName: 'status',
        expectedValue: 'pending',
      }),
    ).resolves.toMatchObject({
      written: true,
      existingValue: JSON.stringify({ status: 'pending', value: 1 }),
    });
    await expect(
      store.compareAndSetJsonField('local:promotion', JSON.stringify({ status: 'rejected' }), {
        fieldName: 'status',
        expectedValue: 'pending',
      }),
    ).resolves.toMatchObject({
      written: false,
      existingValue: JSON.stringify({ status: 'applied' }),
    });
  });
});
