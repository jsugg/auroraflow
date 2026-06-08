import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  SelectorRegistryRepository,
  buildSelectorRegistryNamespaces,
  type SelectorStore,
} from '../../data/selectors/selectorRegistry';
import { createRedisSelectorStore } from '../../data/selectors/redisSelectorStore';
import { getRedisClient, type RedisClient } from '../../utils/redisClient';
import { parsePendingSelectorPromotion, parseSelectorCandidateHistory } from './artifactSchema';
import type {
  PendingSelectorPromotionQuery,
  PendingSelectorPromotionRepository,
  SelectorCandidateHistoryRepository,
  SelectorRegistryEntry,
  SelectorRegistryLookup,
  SelectorRegistryReader,
  SelfHealingRegistryRuntime,
} from './registryContracts';
import type {
  PendingSelectorPromotion,
  SelectorCandidateHistory,
  SelfHealingConfig,
} from './types';

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

class StoreSelectorCandidateHistoryRepository implements SelectorCandidateHistoryRepository {
  private readonly namespace: string;

  public constructor(
    private readonly store: SelectorStore,
    activeNamespace: string,
  ) {
    this.namespace = buildSelectorRegistryNamespaces(activeNamespace).history;
  }

  public async get(candidateId: string): Promise<SelectorCandidateHistory | null> {
    const payload = await this.store.get(this.keyFor(candidateId));
    if (payload === null) {
      return null;
    }
    return parseSelectorCandidateHistory(JSON.parse(payload) as unknown);
  }

  public async getMany(
    candidateIds: readonly string[],
  ): Promise<ReadonlyMap<string, SelectorCandidateHistory>> {
    if (candidateIds.length === 0) {
      return new Map();
    }

    const keys = candidateIds.map((candidateId) => this.keyFor(candidateId));
    const payloads = this.store.getMany
      ? await this.store.getMany(keys)
      : await Promise.all(keys.map((key) => this.store.get(key)));
    const histories = new Map<string, SelectorCandidateHistory>();

    for (let index = 0; index < candidateIds.length; index += 1) {
      const payload = payloads[index];
      if (payload === null || payload === undefined) {
        continue;
      }
      const history = parseSelectorCandidateHistory(JSON.parse(payload) as unknown);
      histories.set(candidateIds[index], history);
    }

    return histories;
  }

  private keyFor(candidateId: string): string {
    return `${this.namespace}:${candidateId.trim()}`;
  }
}

class StorePendingSelectorPromotionRepository implements PendingSelectorPromotionRepository {
  private readonly namespace: string;

  public constructor(
    private readonly store: SelectorStore,
    activeNamespace: string,
  ) {
    this.namespace = buildSelectorRegistryNamespaces(activeNamespace).promotions;
  }

  public async get(eventId: string): Promise<PendingSelectorPromotion | null> {
    const payload = await this.store.get(this.keyFor(eventId));
    if (payload === null) {
      return null;
    }
    return parsePendingSelectorPromotion(JSON.parse(payload) as unknown);
  }

  public async list(
    query: PendingSelectorPromotionQuery = {},
  ): Promise<readonly PendingSelectorPromotion[]> {
    const keys = await this.listPromotionKeys(query.limit);
    const payloads = this.store.getMany
      ? await this.store.getMany(keys)
      : await Promise.all(keys.map((key) => this.store.get(key)));
    const promotions: PendingSelectorPromotion[] = [];

    for (const payload of payloads) {
      if (payload === null || payload === undefined) {
        continue;
      }
      const promotion = parsePendingSelectorPromotion(JSON.parse(payload) as unknown);
      if (query.selectorId && promotion.selectorId !== query.selectorId) {
        continue;
      }
      if (query.candidateId && promotion.candidateId !== query.candidateId) {
        continue;
      }
      if (!query.includeAcknowledged && promotion.acknowledged) {
        continue;
      }
      promotions.push(promotion);
    }

    return promotions;
  }

  public async upsert(promotion: PendingSelectorPromotion): Promise<PendingSelectorPromotion> {
    await this.store.set(this.keyFor(promotion.eventId), JSON.stringify(promotion));
    return promotion;
  }

  private async listPromotionKeys(limit = 100): Promise<string[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
    const pattern = `${this.namespace}:*`;
    const keys: string[] = [];
    if (this.store.scanKeys) {
      for await (const key of this.store.scanKeys(pattern)) {
        keys.push(key);
        if (keys.length >= boundedLimit) {
          break;
        }
      }
      return keys.sort();
    }

    return (await this.store.keys(pattern)).sort().slice(0, boundedLimit);
  }

  private keyFor(eventId: string): string {
    return `${this.namespace}:${eventId.trim()}`;
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
    histories: new StoreSelectorCandidateHistoryRepository(store, namespace),
    promotions: new StorePendingSelectorPromotionRepository(store, namespace),
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
