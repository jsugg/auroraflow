import type { RedisClient } from '../../utils/redisClient';
import type {
  SelectorStore,
  SelectorStoreCompareAndSetOptions,
  SelectorStoreCompareAndSetResult,
  SelectorStoreCompareAndSetJsonFieldOptions,
  SelectorStoreJsonMergePatch,
  SelectorStoreSetOptions,
} from './selectorRegistry';

/** Creates a selector store backed by AuroraFlow's Redis client. */
export function createRedisSelectorStore(client: RedisClient): SelectorStore {
  return {
    get: (key: string) => client.get(key),
    getMany: (keys: readonly string[]) => client.mget(keys),
    set: (key: string, value: string, options?: SelectorStoreSetOptions) =>
      client.set(key, value, options),
    compareAndSet: (
      key: string,
      value: string,
      options: SelectorStoreCompareAndSetOptions,
    ): Promise<SelectorStoreCompareAndSetResult> =>
      client.compareAndSetJsonVersion(key, value, options),
    compareAndSetJsonField: (
      key: string,
      value: string,
      options: SelectorStoreCompareAndSetJsonFieldOptions,
    ): Promise<SelectorStoreCompareAndSetResult> =>
      client.compareAndSetJsonField(key, value, options),
    atomicJsonMerge: (
      key: string,
      patch: SelectorStoreJsonMergePatch,
      options?: SelectorStoreSetOptions,
    ): Promise<string> => client.atomicJsonMerge(key, { patch, ...options }),
    del: (key: string) => client.del(key),
    keys: (pattern: string) => client.keys(pattern),
    scanKeys: (pattern: string) => client.scanKeys(pattern),
  };
}
