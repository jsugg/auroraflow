import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  SelectorRegistryRepository,
  type SelectorStore,
} from '../../data/selectors/selectorRegistry';
import { createRedisSelectorStore } from '../../data/selectors/redisSelectorStore';
import { getRedisClient, type RedisClient } from '../../utils/redisClient';
import { StoreSelectorCandidateHistoryRepository } from './historyRepository';
import { StorePendingSelectorPromotionRepository } from './promotionRepository';
import type {
  SelectorRegistryEntry,
  SelectorRegistryLookup,
  SelectorRegistryReader,
  SelfHealingRegistryRuntime,
} from './registryContracts';
import type { SelfHealingConfig } from './types';

const EXPLICIT_REDIS_CONFIG_KEYS = Object.freeze([
  'AURORAFLOW_REDIS_URL',
  'AURORAFLOW_REDIS_HOST',
  'AURORAFLOW_REDIS_PORT',
  'AURORAFLOW_REDIS_DB',
  'AURORAFLOW_REDIS_USERNAME',
  'AURORAFLOW_REDIS_PASSWORD',
  'AURORAFLOW_REDIS_TLS',
  'AURORAFLOW_REDIS_KEY_PREFIX',
]);

export interface StoreSelfHealingRegistryRuntimeOptions {
  store: SelectorStore;
  namespace?: string;
  required?: boolean;
}

export interface RedisSelfHealingRegistryRuntimeOptions {
  client?: RedisClient;
  namespace?: string;
  required?: boolean;
}

export interface ResolveSelfHealingRegistryRuntimeOptions {
  client?: RedisClient;
}

class SelectorRegistryReaderAdapter implements SelectorRegistryReader {
  public constructor(private readonly repository: SelectorRegistryRepository) {}

  public get(selectorId: string): Promise<SelectorRegistryEntry | null> {
    return this.repository.get(selectorId);
  }

  public findCandidates(lookup: SelectorRegistryLookup): Promise<readonly SelectorRegistryEntry[]> {
    if (lookup.selectorId) {
      return this.repository
        .get(lookup.selectorId)
        .then((entry) => (entry === null ? [] : [entry]));
    }

    if (lookup.actionType) {
      return this.repository.listByPageObjectAndAction(
        lookup.pageObjectName,
        lookup.actionType,
        lookup.limit,
      );
    }

    return this.repository.listByPageObject(lookup.pageObjectName);
  }
}

function parseBoolean(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(rawValue.trim().toLowerCase());
}

function hasExplicitRedisConfig(env: Readonly<Record<string, string | undefined>>): boolean {
  return EXPLICIT_REDIS_CONFIG_KEYS.some((key) => {
    const value = env[key];
    return value !== undefined && value.trim().length > 0;
  });
}

function resolveRegistryNamespace(env: Readonly<Record<string, string | undefined>>): string {
  return env.SELF_HEAL_REGISTRY_NAMESPACE?.trim() || DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active;
}

export function createStoreSelfHealingRegistryRuntime({
  store,
  namespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
  required = false,
}: StoreSelfHealingRegistryRuntimeOptions): SelfHealingRegistryRuntime {
  const selectors = new SelectorRegistryRepository({ store, namespace });
  return {
    selectors: new SelectorRegistryReaderAdapter(selectors),
    histories: new StoreSelectorCandidateHistoryRepository({ store, activeNamespace: namespace }),
    promotions: new StorePendingSelectorPromotionRepository({ store, activeNamespace: namespace }),
    required,
  };
}

export function createRedisSelfHealingRegistryRuntime({
  client = getRedisClient(),
  namespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
  required = false,
}: RedisSelfHealingRegistryRuntimeOptions = {}): SelfHealingRegistryRuntime {
  return createStoreSelfHealingRegistryRuntime({
    store: createRedisSelectorStore(client),
    namespace,
    required,
  });
}

export function resolveSelfHealingRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  config: SelfHealingConfig,
  options: ResolveSelfHealingRegistryRuntimeOptions = {},
): SelfHealingRegistryRuntime | undefined {
  if (config.sat.registryMode === 'off') {
    return undefined;
  }

  const required = parseBoolean(env.SELF_HEAL_REGISTRY_REQUIRED);
  if (!required && !hasExplicitRedisConfig(env)) {
    return undefined;
  }

  return createRedisSelfHealingRegistryRuntime({
    client: options.client,
    namespace: resolveRegistryNamespace(env),
    required,
  });
}
