import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  buildSelectorRegistryNamespaces,
  type SelectorStore,
} from '../src/data/selectors/selectorRegistry';
import { createSelfHealingScriptStoreHandle } from './self-healing-script-store';

export interface SelfHealingRegistryCleanupOptions {
  store: SelectorStore;
  activeNamespace?: string;
  now?: Date;
  limit?: number;
}

export interface SelfHealingRegistryCleanupSummary {
  historyScanned: number;
  historyDeleted: number;
  promotionsScanned: number;
  promotionsDeleted: number;
  malformedRecords: number;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('SELF_HEAL_REGISTRY_CLEANUP_LIMIT must be a positive integer.');
  }
  return parsed;
}

function readExpiresAt(payload: string): string | undefined {
  const parsed = JSON.parse(payload) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('registry record must be a JSON object.');
  }
  const expiresAt = (parsed as Record<string, unknown>).expiresAt;
  if (expiresAt === undefined) {
    return undefined;
  }
  if (typeof expiresAt !== 'string') {
    throw new Error('registry record expiresAt must be a string.');
  }
  return expiresAt;
}

async function listNamespaceKeys(
  store: SelectorStore,
  namespace: string,
  limit: number,
): Promise<string[]> {
  const pattern = `${namespace}:*`;
  const keys: string[] = [];
  if (store.scanKeys) {
    for await (const key of store.scanKeys(pattern)) {
      keys.push(key);
      if (keys.length >= limit) {
        break;
      }
    }
    return keys;
  }
  return (await store.keys(pattern)).slice(0, limit);
}

async function cleanupNamespace({
  store,
  namespace,
  now,
  limit,
}: {
  store: SelectorStore;
  namespace: string;
  now: Date;
  limit: number;
}): Promise<{ scanned: number; deleted: number; malformed: number }> {
  const keys = await listNamespaceKeys(store, namespace, limit);
  let deleted = 0;
  let malformed = 0;

  for (const key of keys) {
    const payload = await store.get(key);
    if (payload === null) {
      continue;
    }
    try {
      const expiresAt = readExpiresAt(payload);
      if (expiresAt !== undefined) {
        const expiresAtMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiresAtMs)) {
          throw new Error('registry record expiresAt must be an ISO timestamp.');
        }
        if (expiresAtMs <= now.getTime()) {
          deleted += await store.del(key);
        }
      }
    } catch {
      malformed += 1;
    }
  }

  return { scanned: keys.length, deleted, malformed };
}

/** Removes expired SAT history and pending promotion records, leaving active/audit keys intact. */
export async function cleanupExpiredSelfHealingRegistryRecords({
  store,
  activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
  now = new Date(),
  limit = 1_000,
}: SelfHealingRegistryCleanupOptions): Promise<SelfHealingRegistryCleanupSummary> {
  const namespaces = buildSelectorRegistryNamespaces(activeNamespace);
  const history = await cleanupNamespace({
    store,
    namespace: namespaces.history,
    now,
    limit,
  });
  const promotions = await cleanupNamespace({
    store,
    namespace: namespaces.promotions,
    now,
    limit,
  });

  return {
    historyScanned: history.scanned,
    historyDeleted: history.deleted,
    promotionsScanned: promotions.scanned,
    promotionsDeleted: promotions.deleted,
    malformedRecords: history.malformed + promotions.malformed,
  };
}

async function main(): Promise<void> {
  const activeNamespace =
    process.env.SELF_HEAL_REGISTRY_NAMESPACE ?? DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active;
  const limit = parsePositiveInteger(process.env.SELF_HEAL_REGISTRY_CLEANUP_LIMIT, 1_000);
  const handle = createSelfHealingScriptStoreHandle();
  try {
    const summary = await cleanupExpiredSelfHealingRegistryRecords({
      store: handle.store,
      activeNamespace,
      limit,
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await handle.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
