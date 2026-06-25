import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  buildSelectorRegistryNamespaces,
  type SelectorStore,
} from '../src/data/selectors/selectorRegistry';
import { createSelfHealingScriptStoreHandle } from './self-healing-script-store';
import {
  DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS,
  MAX_PROMOTION_AUDIT_RETENTION_SECONDS,
} from '../src/framework/selfHealing/promotionWorkflow';

export interface SelfHealingRegistryCleanupOptions {
  store: SelectorStore;
  activeNamespace?: string;
  auditRetentionSeconds?: number;
  dryRun?: boolean;
  now?: Date;
  limit?: number;
}

export interface SelfHealingRegistryCleanupSummary {
  auditDeleted: number;
  auditExpired: number;
  auditLegalHold: number;
  auditScanned: number;
  dryRun: boolean;
  historyScanned: number;
  historyExpired: number;
  historyDeleted: number;
  promotionsScanned: number;
  promotionsExpired: number;
  promotionsDeleted: number;
  malformedRecords: number;
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  envVar = 'SELF_HEAL_REGISTRY_CLEANUP_LIMIT',
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envVar} must be a positive integer.`);
  }
  return parsed;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function addSeconds(timestamp: string, seconds: number): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new Error('registry record timestamp must be an ISO timestamp.');
  }
  return new Date(parsed + seconds * 1_000).toISOString();
}

function normalizeAuditRetentionSeconds(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('SELF_HEAL_AUDIT_RETENTION_SECONDS must be a positive integer.');
  }
  return Math.min(value, MAX_PROMOTION_AUDIT_RETENTION_SECONDS);
}

function readRecord(payload: string): Record<string, unknown> {
  const parsed = JSON.parse(payload) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('registry record must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function readOptionalStringField(
  record: Readonly<Record<string, unknown>>,
  fieldName: string,
): string | undefined {
  const value = record[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`registry record ${fieldName} must be a string.`);
  }
  return value;
}

interface CleanupMetadata {
  expiresAt?: string;
  legalHold: boolean;
}

function readExpiresAt(payload: string): CleanupMetadata {
  const record = readRecord(payload);
  const expiresAt = readOptionalStringField(record, 'expiresAt');
  return { expiresAt, legalHold: false };
}

function readAuditMetadata(payload: string, auditRetentionSeconds: number): CleanupMetadata {
  const record = readRecord(payload);
  const legalHold = record.legalHold;
  if (legalHold !== undefined && typeof legalHold !== 'boolean') {
    throw new Error('registry audit legalHold must be a boolean.');
  }
  if (legalHold === true) {
    return { legalHold: true };
  }

  const expiresAt = readOptionalStringField(record, 'expiresAt');
  if (expiresAt === undefined) {
    const reviewedAt = readOptionalStringField(record, 'reviewedAt');
    return {
      expiresAt:
        reviewedAt === undefined ? undefined : addSeconds(reviewedAt, auditRetentionSeconds),
      legalHold: false,
    };
  }
  return { expiresAt, legalHold: false };
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
  dryRun,
  now,
  limit,
  readMetadata,
}: {
  store: SelectorStore;
  namespace: string;
  dryRun: boolean;
  now: Date;
  limit: number;
  readMetadata: (payload: string) => CleanupMetadata;
}): Promise<{
  scanned: number;
  expired: number;
  deleted: number;
  malformed: number;
  legalHold: number;
}> {
  const keys = await listNamespaceKeys(store, namespace, limit);
  let expired = 0;
  let deleted = 0;
  let malformed = 0;
  let legalHold = 0;

  for (const key of keys) {
    const payload = await store.get(key);
    if (payload === null) {
      continue;
    }
    try {
      const metadata = readMetadata(payload);
      if (metadata.legalHold) {
        legalHold += 1;
        continue;
      }
      if (metadata.expiresAt !== undefined) {
        const expiresAtMs = Date.parse(metadata.expiresAt);
        if (!Number.isFinite(expiresAtMs)) {
          throw new Error('registry record expiresAt must be an ISO timestamp.');
        }
        if (expiresAtMs <= now.getTime()) {
          expired += 1;
          if (!dryRun) {
            deleted += await store.del(key);
          }
        }
      }
    } catch {
      malformed += 1;
    }
  }

  return { scanned: keys.length, expired, deleted, malformed, legalHold };
}

/** Finds expired SAT registry records; destructive deletion requires dryRun=false. */
export async function cleanupExpiredSelfHealingRegistryRecords({
  store,
  activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
  auditRetentionSeconds,
  dryRun = true,
  now = new Date(),
  limit = 1_000,
}: SelfHealingRegistryCleanupOptions): Promise<SelfHealingRegistryCleanupSummary> {
  const namespaces = buildSelectorRegistryNamespaces(activeNamespace);
  const normalizedAuditRetentionSeconds = normalizeAuditRetentionSeconds(auditRetentionSeconds);
  const history = await cleanupNamespace({
    store,
    namespace: namespaces.history,
    dryRun,
    now,
    limit,
    readMetadata: readExpiresAt,
  });
  const promotions = await cleanupNamespace({
    store,
    namespace: namespaces.promotions,
    dryRun,
    now,
    limit,
    readMetadata: readExpiresAt,
  });
  const audit = await cleanupNamespace({
    store,
    namespace: namespaces.audit,
    dryRun,
    now,
    limit,
    readMetadata: (payload) => readAuditMetadata(payload, normalizedAuditRetentionSeconds),
  });

  return {
    auditScanned: audit.scanned,
    auditExpired: audit.expired,
    auditDeleted: audit.deleted,
    auditLegalHold: audit.legalHold,
    dryRun,
    historyScanned: history.scanned,
    historyExpired: history.expired,
    historyDeleted: history.deleted,
    promotionsScanned: promotions.scanned,
    promotionsExpired: promotions.expired,
    promotionsDeleted: promotions.deleted,
    malformedRecords: history.malformed + promotions.malformed + audit.malformed,
  };
}

async function main(): Promise<void> {
  const activeNamespace =
    process.env.SELF_HEAL_REGISTRY_NAMESPACE ?? DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active;
  const limit = parsePositiveInteger(process.env.SELF_HEAL_REGISTRY_CLEANUP_LIMIT, 1_000);
  const auditRetentionEnv = process.env.SELF_HEAL_AUDIT_RETENTION_SECONDS;
  const auditRetentionSeconds = normalizeAuditRetentionSeconds(
    auditRetentionEnv === undefined || auditRetentionEnv.trim() === ''
      ? undefined
      : parsePositiveInteger(
          auditRetentionEnv,
          DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS,
          'SELF_HEAL_AUDIT_RETENTION_SECONDS',
        ),
  );
  const dryRun = !parseBooleanEnv(process.env.SELF_HEAL_REGISTRY_CLEANUP_APPLY, false);
  const handle = createSelfHealingScriptStoreHandle();
  try {
    const summary = await cleanupExpiredSelfHealingRegistryRecords({
      store: handle.store,
      activeNamespace,
      auditRetentionSeconds,
      dryRun,
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
