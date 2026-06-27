import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  buildSelectorRegistryNamespaces,
  parseSelectorRecordPayload,
  serializeSelectorRecord,
  type SelectorRecord,
  type SelectorStore,
} from '../src/data/selectors/selectorRegistry';
import { createSelfHealingScriptStoreHandle } from './self-healing-script-store';

const DEFAULT_REPAIR_LIMIT = 1_000;

export interface SelfHealingRegistryRepairOptions {
  store: SelectorStore;
  activeNamespace?: string;
  dryRun?: boolean;
  limit?: number;
}

export interface SelfHealingRegistryRepairSummary {
  dryRun: boolean;
  recordsScanned: number;
  recordsTruncated: boolean;
  legacyRecords: number;
  recordsUpgraded: number;
  upgradeConflicts: number;
  malformedRecords: number;
  indexKeysScanned: number;
  indexKeysTruncated: boolean;
  missingIndexes: number;
  staleIndexes: number;
  mismatchedIndexes: number;
  unverifiableIndexes: number;
  indexesCreated: number;
  indexesUpdated: number;
  indexesDeleted: number;
  diagnostics: readonly SelfHealingRegistryRepairDiagnostic[];
}

export interface SelfHealingRegistryRepairDiagnostic {
  key: string;
  message: string;
}

interface ListedKeys {
  keys: string[];
  truncated: boolean;
}

interface ParsedActiveRecord {
  key: string;
  record: SelectorRecord;
  legacy: boolean;
}

function normalizeLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_REPAIR_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new Error('registry repair limit must be an integer between 1 and 100000.');
  }
  return value;
}

async function listKeys(store: SelectorStore, pattern: string, limit: number): Promise<ListedKeys> {
  const keys: string[] = [];
  if (store.scanKeys) {
    for await (const key of store.scanKeys(pattern)) {
      keys.push(key);
      if (keys.length > limit) {
        break;
      }
    }
  } else {
    keys.push(...(await store.keys(pattern)));
  }
  keys.sort((left, right) => left.localeCompare(right));
  return { keys: keys.slice(0, limit), truncated: keys.length > limit };
}

async function loadPayloads(
  store: SelectorStore,
  keys: readonly string[],
): Promise<Array<string | null>> {
  return store.getMany ? store.getMany(keys) : Promise.all(keys.map((key) => store.get(key)));
}

function activeKeyFor(namespace: string, record: SelectorRecord): string {
  return `${namespace}:${record.id}`;
}

function indexKeyFor(indexNamespace: string, record: SelectorRecord): string {
  return `${indexNamespace}:${record.pageObjectName}:${record.actionType}:${record.id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Audits selector schema/index drift and optionally repairs it. Dry-run is default. */
export async function repairSelfHealingRegistry({
  store,
  activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
  dryRun = true,
  limit,
}: SelfHealingRegistryRepairOptions): Promise<SelfHealingRegistryRepairSummary> {
  const boundedLimit = normalizeLimit(limit);
  const namespaces = buildSelectorRegistryNamespaces(activeNamespace);
  const activeListing = await listKeys(store, `${namespaces.active}:*`, boundedLimit);
  const activePayloads = await loadPayloads(store, activeListing.keys);
  const parsedRecords: ParsedActiveRecord[] = [];
  const activeKeys = new Set(activeListing.keys);
  const diagnostics: SelfHealingRegistryRepairDiagnostic[] = [];
  let malformedRecords = 0;

  for (let index = 0; index < activeListing.keys.length; index += 1) {
    const key = activeListing.keys[index];
    const payload = activePayloads[index];
    if (payload === null || payload === undefined) {
      diagnostics.push({ key, message: 'Active record disappeared during repair scan.' });
      continue;
    }
    try {
      const parsed = parseSelectorRecordPayload(payload, key);
      if (activeKeyFor(namespaces.active, parsed.record) !== key) {
        malformedRecords += 1;
        diagnostics.push({ key, message: 'Selector record id does not match its active key.' });
        continue;
      }
      parsedRecords.push({
        key,
        record: parsed.record,
        legacy: parsed.compatibility === 'legacy',
      });
    } catch (error: unknown) {
      malformedRecords += 1;
      diagnostics.push({ key, message: errorMessage(error) });
    }
  }

  const legacyRecords = parsedRecords.filter((entry) => entry.legacy);
  if (!dryRun && legacyRecords.length > 0 && !store.compareAndSet) {
    throw new Error('registry repair apply requires compareAndSet for legacy record upgrades.');
  }

  let recordsUpgraded = 0;
  let upgradeConflicts = 0;
  if (!dryRun) {
    for (const entry of legacyRecords) {
      const result = await store.compareAndSet!(entry.key, serializeSelectorRecord(entry.record), {
        expectedVersion: entry.record.version,
      });
      if (result.written) {
        recordsUpgraded += 1;
      } else {
        upgradeConflicts += 1;
        diagnostics.push({
          key: entry.key,
          message:
            'Legacy upgrade conflicted with a concurrent record change; index audit reloaded it.',
        });
      }
    }
  }

  const verifiedRecords: ParsedActiveRecord[] = [];
  for (const entry of parsedRecords) {
    const payload = await store.get(entry.key);
    if (payload === null) {
      diagnostics.push({
        key: entry.key,
        message: 'Active record disappeared before index audit.',
      });
      continue;
    }
    try {
      const parsed = parseSelectorRecordPayload(payload, entry.key);
      if (activeKeyFor(namespaces.active, parsed.record) !== entry.key) {
        diagnostics.push({
          key: entry.key,
          message: 'Selector record id changed and no longer matches its active key.',
        });
        continue;
      }
      verifiedRecords.push({
        key: entry.key,
        record: parsed.record,
        legacy: parsed.compatibility === 'legacy',
      });
    } catch (error: unknown) {
      diagnostics.push({ key: entry.key, message: errorMessage(error) });
    }
  }

  const expectedIndexes = new Map<string, string>();
  const expectedIndexByActiveKey = new Map<string, string>();
  for (const entry of verifiedRecords) {
    const indexKey = indexKeyFor(namespaces.index, entry.record);
    expectedIndexes.set(indexKey, entry.key);
    expectedIndexByActiveKey.set(entry.key, indexKey);
  }

  const indexListing = await listKeys(store, `${namespaces.index}:*`, boundedLimit);
  const indexPayloads = await loadPayloads(store, indexListing.keys);
  const existingIndexes = new Map<string, string>();
  for (let index = 0; index < indexListing.keys.length; index += 1) {
    const payload = indexPayloads[index];
    if (payload !== null && payload !== undefined) {
      existingIndexes.set(indexListing.keys[index], payload);
    }
  }

  let missingIndexes = 0;
  let staleIndexes = 0;
  let mismatchedIndexes = 0;
  let unverifiableIndexes = 0;
  let indexesCreated = 0;
  let indexesUpdated = 0;
  let indexesDeleted = 0;

  for (const [indexKey, targetKey] of expectedIndexes) {
    const existingTarget = existingIndexes.get(indexKey);
    if (existingTarget === undefined) {
      missingIndexes += 1;
      if (!dryRun) {
        await store.set(indexKey, targetKey);
        indexesCreated += 1;
      }
    } else if (existingTarget !== targetKey) {
      mismatchedIndexes += 1;
      if (!dryRun) {
        await store.set(indexKey, targetKey);
        indexesUpdated += 1;
      }
    }
  }

  for (const [indexKey, targetKey] of existingIndexes) {
    if (expectedIndexes.has(indexKey)) {
      continue;
    }
    const targetExpectedIndex = expectedIndexByActiveKey.get(targetKey);
    const safeToDelete =
      targetExpectedIndex !== undefined
        ? targetExpectedIndex !== indexKey
        : !activeListing.truncated && !activeKeys.has(targetKey);
    if (!safeToDelete) {
      unverifiableIndexes += 1;
      diagnostics.push({
        key: indexKey,
        message: `Index target ${targetKey} could not be proven stale; index retained.`,
      });
      continue;
    }
    staleIndexes += 1;
    if (!dryRun) {
      indexesDeleted += await store.del(indexKey);
    }
  }

  return {
    dryRun,
    recordsScanned: activeListing.keys.length,
    recordsTruncated: activeListing.truncated,
    legacyRecords: legacyRecords.length,
    recordsUpgraded,
    upgradeConflicts,
    malformedRecords,
    indexKeysScanned: indexListing.keys.length,
    indexKeysTruncated: indexListing.truncated,
    missingIndexes,
    staleIndexes,
    mismatchedIndexes,
    unverifiableIndexes,
    indexesCreated,
    indexesUpdated,
    indexesDeleted,
    diagnostics,
  };
}

interface RepairCliOptions {
  activeNamespace: string;
  apply: boolean;
  limit: number;
}

function parseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv): RepairCliOptions {
  let activeNamespace =
    env.SELF_HEAL_REGISTRY_NAMESPACE ?? DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active;
  let apply = env.SELF_HEAL_REGISTRY_REPAIR_APPLY?.trim().toLowerCase() === 'true';
  let limit = normalizeLimit(
    env.SELF_HEAL_REGISTRY_REPAIR_LIMIT === undefined
      ? undefined
      : Number(env.SELF_HEAL_REGISTRY_REPAIR_LIMIT),
  );

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--namespace' || argument === '--limit') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === '--namespace') {
        activeNamespace = value;
      } else {
        limit = normalizeLimit(Number(value));
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { activeNamespace, apply, limit };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env);
  const handle = createSelfHealingScriptStoreHandle();
  try {
    const summary = await repairSelfHealingRegistry({
      store: handle.store,
      activeNamespace: options.activeNamespace,
      dryRun: !options.apply,
      limit: options.limit,
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await handle.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
