import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  buildSelectorRegistryNamespaces,
  type SelectorStore,
} from '../../data/selectors/selectorRegistry';
import { parsePendingSelectorPromotion } from './artifactSchema';
import type {
  PendingSelectorPromotionQuery,
  PendingSelectorPromotionRepository,
} from './registryContracts';
import type { PendingSelectorPromotion } from './types';

export interface StorePendingSelectorPromotionRepositoryOptions {
  store: SelectorStore;
  activeNamespace?: string;
}

function ttlSecondsUntil(expiresAt: string, now = new Date()): number {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error('pending promotion expiresAt must be an ISO timestamp.');
  }
  const ttlSeconds = Math.ceil((expiresAtMs - now.getTime()) / 1000);
  return Math.max(1, ttlSeconds);
}

/** Store-backed pending-promotion repository keyed by self-healing event ID. */
export class StorePendingSelectorPromotionRepository implements PendingSelectorPromotionRepository {
  private readonly namespace: string;

  private readonly store: SelectorStore;

  public constructor({
    store,
    activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
  }: StorePendingSelectorPromotionRepositoryOptions) {
    this.store = store;
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
      if (
        !query.includeAcknowledged &&
        (promotion.acknowledged || promotion.status !== 'pending')
      ) {
        continue;
      }
      promotions.push(promotion);
    }

    return promotions;
  }

  public async findByPromotionId(promotionId: string): Promise<PendingSelectorPromotion | null> {
    const normalizedPromotionId = promotionId.trim();
    if (!normalizedPromotionId) {
      throw new Error('promotionId must be non-empty.');
    }

    const keys = await this.listPromotionKeys(Number.POSITIVE_INFINITY);
    const payloads = this.store.getMany
      ? await this.store.getMany(keys)
      : await Promise.all(keys.map((key) => this.store.get(key)));

    for (const payload of payloads) {
      if (payload === null || payload === undefined) {
        continue;
      }
      const promotion = parsePendingSelectorPromotion(JSON.parse(payload) as unknown);
      if (promotion.promotionId === normalizedPromotionId) {
        return promotion;
      }
    }

    return null;
  }

  public async upsert(promotion: PendingSelectorPromotion): Promise<PendingSelectorPromotion> {
    const ttlSeconds =
      promotion.expiresAt === undefined ? undefined : ttlSecondsUntil(promotion.expiresAt);
    await this.store.set(
      this.keyFor(promotion.eventId),
      JSON.stringify(promotion),
      ttlSeconds === undefined ? undefined : { ttlSeconds },
    );
    return promotion;
  }

  public async delete(eventId: string): Promise<number> {
    return this.store.del(this.keyFor(eventId));
  }

  private async listPromotionKeys(limit = 100): Promise<string[]> {
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : Number.MAX_SAFE_INTEGER;
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
