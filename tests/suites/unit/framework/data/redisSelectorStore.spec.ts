import { describe, expect, it, vi } from 'vitest';
import { createRedisSelectorStore } from '../../../../../src/data/selectors/redisSelectorStore';
import type {
  SelectorStoreCompareAndSetOptions,
  SelectorStoreJsonMergePatch,
} from '../../../../../src/data/selectors/selectorRegistry';
import type { RedisClient } from '../../../../../src/utils/redisClient';

/**
 * AUR-QE-109: the Redis-backed selector store is a thin adapter over `RedisClient`.
 * These tests pin that every store method delegates to the matching client method
 * with the expected argument shape, including the merge-options spread and the
 * `compareAndSet` -> `compareAndSetJsonVersion` mapping.
 */
function createFakeRedisClient(): {
  client: RedisClient;
  mocks: {
    get: ReturnType<typeof vi.fn>;
    mget: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    compareAndSetJsonVersion: ReturnType<typeof vi.fn>;
    atomicJsonMerge: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    keys: ReturnType<typeof vi.fn>;
    scanKeys: ReturnType<typeof vi.fn>;
  };
} {
  const mocks = {
    get: vi.fn(async () => 'stored-value'),
    mget: vi.fn(async () => ['a', null]),
    set: vi.fn(async () => undefined),
    compareAndSetJsonVersion: vi.fn(async () => ({ written: true, existingValue: null })),
    atomicJsonMerge: vi.fn(async () => '{"version":2}'),
    del: vi.fn(async () => 1),
    keys: vi.fn(async () => ['auroraflow:selectors:login']),
    scanKeys: vi.fn(() => (async function* empty() {})()),
  };
  return { client: mocks as unknown as RedisClient, mocks };
}

describe('createRedisSelectorStore', () => {
  it('delegates reads to the Redis client', async () => {
    const { client, mocks } = createFakeRedisClient();
    const store = createRedisSelectorStore(client);

    await expect(store.get('selectors:login')).resolves.toBe('stored-value');
    expect(mocks.get).toHaveBeenCalledWith('selectors:login');

    await expect(store.getMany?.(['a', 'b'])).resolves.toEqual(['a', null]);
    expect(mocks.mget).toHaveBeenCalledWith(['a', 'b']);

    await expect(store.keys('selectors:*')).resolves.toEqual(['auroraflow:selectors:login']);
    expect(mocks.keys).toHaveBeenCalledWith('selectors:*');
  });

  it('forwards set options and key deletion verbatim', async () => {
    const { client, mocks } = createFakeRedisClient();
    const store = createRedisSelectorStore(client);

    await store.set('selectors:login', 'payload', { ttlSeconds: 90 });
    expect(mocks.set).toHaveBeenCalledWith('selectors:login', 'payload', { ttlSeconds: 90 });

    await expect(store.del('selectors:login')).resolves.toBe(1);
    expect(mocks.del).toHaveBeenCalledWith('selectors:login');
  });

  it('maps compareAndSet to the Redis compare-and-set-json-version primitive', async () => {
    const { client, mocks } = createFakeRedisClient();
    const store = createRedisSelectorStore(client);
    const options: SelectorStoreCompareAndSetOptions = { expectedVersion: 3, ttlSeconds: 120 };

    const result = await store.compareAndSet?.('selectors:login', 'payload', options);

    expect(result).toEqual({ written: true, existingValue: null });
    expect(mocks.compareAndSetJsonVersion).toHaveBeenCalledWith(
      'selectors:login',
      'payload',
      options,
    );
  });

  it('spreads merge options into the atomic JSON merge payload', async () => {
    const { client, mocks } = createFakeRedisClient();
    const store = createRedisSelectorStore(client);
    const patch: SelectorStoreJsonMergePatch = {
      defaultValue: { version: 1 },
      increments: { validated: 1 },
      set: { lastSeen: 'now' },
    };

    await expect(
      store.atomicJsonMerge?.('selectors:login', patch, { ttlSeconds: 30 }),
    ).resolves.toBe('{"version":2}');
    expect(mocks.atomicJsonMerge).toHaveBeenCalledWith('selectors:login', {
      patch,
      ttlSeconds: 30,
    });
  });

  it('omits absent merge options while still wrapping the patch', async () => {
    const { client, mocks } = createFakeRedisClient();
    const store = createRedisSelectorStore(client);
    const patch: SelectorStoreJsonMergePatch = { defaultValue: { version: 1 } };

    await store.atomicJsonMerge?.('selectors:login', patch);

    expect(mocks.atomicJsonMerge).toHaveBeenCalledWith('selectors:login', { patch });
  });

  it('passes the scan generator through unchanged', () => {
    const { client, mocks } = createFakeRedisClient();
    const store = createRedisSelectorStore(client);

    const iterator = store.scanKeys?.('selectors:*');

    expect(iterator).toBeDefined();
    expect(mocks.scanKeys).toHaveBeenCalledWith('selectors:*');
  });
});
