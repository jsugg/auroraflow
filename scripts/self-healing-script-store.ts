import type { SelectorStore } from '../src/data/selectors/selectorRegistry';

export const SELF_HEALING_SCRIPT_STORE_KIND_ENV = 'AURORAFLOW_SELF_HEALING_SCRIPT_STORE';

export type SelfHealingScriptStoreKind = 'redis' | 'memory';

export interface SelfHealingScriptStoreHandle {
  readonly kind: SelfHealingScriptStoreKind;
  readonly store: SelectorStore;
  readonly close: () => Promise<void>;
}

/** Creates the selector store used by self-healing maintenance CLIs. */
export function createSelfHealingScriptStoreHandle(
  env: NodeJS.ProcessEnv = process.env,
): SelfHealingScriptStoreHandle {
  const kind = resolveSelfHealingScriptStoreKind(env);
  if (kind === 'memory') {
    const { createMemorySelectorStore } =
      require('../src/data/selectors/memorySelectorStore') as typeof import('../src/data/selectors/memorySelectorStore');
    const store = createMemorySelectorStore();
    return {
      kind,
      store,
      close: () => store.close(),
    };
  }

  const { createRedisSelectorStore } =
    require('../src/data/selectors/redisSelectorStore') as typeof import('../src/data/selectors/redisSelectorStore');
  const { RedisClient } =
    require('../src/utils/redisClient') as typeof import('../src/utils/redisClient');
  const client = new RedisClient({ env });
  return {
    kind,
    store: createRedisSelectorStore(client),
    close: () => client.disconnect(),
  };
}

function resolveSelfHealingScriptStoreKind(env: NodeJS.ProcessEnv): SelfHealingScriptStoreKind {
  const rawKind = env[SELF_HEALING_SCRIPT_STORE_KIND_ENV]?.trim().toLowerCase();
  if (rawKind === undefined || rawKind === '') {
    return 'redis';
  }
  if (rawKind === 'redis' || rawKind === 'memory') {
    return rawKind;
  }
  throw new Error(`${SELF_HEALING_SCRIPT_STORE_KIND_ENV} must be "redis" or "memory".`);
}
