export class SelectorRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorRegistryValidationError';
  }
}

export class SelectorRegistryDataError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SelectorRegistryDataError';
  }
}

export class SelectorRegistryConflictError extends Error {
  constructor(
    message: string,
    public readonly id: string,
    public readonly expectedVersion: number | null,
    public readonly actualVersion: number | null,
  ) {
    super(message);
    this.name = 'SelectorRegistryConflictError';
  }
}

export interface SelectorRecord {
  id: string;
  pageObjectName: string;
  actionType: string;
  locator: string;
  strategy?: string;
  confidence?: number;
  notes?: string;
  updatedAt: string;
  version: number;
}

export interface SelectorUpsertInput {
  id: string;
  pageObjectName: string;
  actionType: string;
  locator: string;
  strategy?: string;
  confidence?: number;
  notes?: string;
}

export interface SelectorUpsertOptions {
  expectedVersion?: number | null;
}

export interface SelectorStoreSetOptions {
  ttlSeconds?: number;
}

export interface SelectorStoreCompareAndSetOptions extends SelectorStoreSetOptions {
  expectedVersion: number | null;
}

export interface SelectorStoreCompareAndSetResult {
  written: boolean;
  existingValue: string | null;
}

export interface SelectorStore {
  get(key: string): Promise<string | null>;
  getMany?(keys: readonly string[]): Promise<Array<string | null>>;
  set(key: string, value: string, options?: SelectorStoreSetOptions): Promise<void>;
  compareAndSet?(
    key: string,
    value: string,
    options: SelectorStoreCompareAndSetOptions,
  ): Promise<SelectorStoreCompareAndSetResult>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scanKeys?(pattern: string): AsyncIterable<string>;
}

export const DEFAULT_SELECTOR_REGISTRY_NAMESPACES = {
  active: 'selector-registry',
  audit: 'selector-audit',
  history: 'selector-history',
  index: 'selector-registry-index',
  promotions: 'selector-promotions',
} as const;

export interface SelectorRegistryNamespaces {
  active: string;
  audit: string;
  history: string;
  index: string;
  promotions: string;
}

const DEFAULT_LIST_BATCH_SIZE = 100;
const DEFAULT_INDEX_LOOKUP_LIMIT = 25;

function validateIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SelectorRegistryValidationError(`${fieldName} must not be empty.`);
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new SelectorRegistryValidationError(
      `${fieldName} may only include letters, numbers, ., _, :, and -.`,
    );
  }

  if (normalized.length > 160) {
    throw new SelectorRegistryValidationError(`${fieldName} must be 160 characters or less.`);
  }

  return normalized;
}

export function buildSelectorRegistryNamespaces(
  activeNamespace: string = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
): SelectorRegistryNamespaces {
  const active = validateIdentifier(activeNamespace, 'namespace');
  if (active === DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active) {
    return { ...DEFAULT_SELECTOR_REGISTRY_NAMESPACES };
  }

  return {
    active,
    audit: validateIdentifier(`${active}-audit`, 'auditNamespace'),
    history: validateIdentifier(`${active}-history`, 'historyNamespace'),
    index: validateIdentifier(`${active}-index`, 'indexNamespace'),
    promotions: validateIdentifier(`${active}-promotions`, 'promotionsNamespace'),
  };
}

function validateExpectedVersion(
  expectedVersion: number | null | undefined,
): number | null | undefined {
  if (expectedVersion === undefined || expectedVersion === null) {
    return expectedVersion;
  }

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new SelectorRegistryValidationError(
      'expectedVersion must be a positive integer, null, or undefined.',
    );
  }

  return expectedVersion;
}

function validateLookupLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_INDEX_LOOKUP_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new SelectorRegistryValidationError('limit must be an integer between 1 and 500.');
  }

  return limit;
}

function validateLocator(locator: string): string {
  const normalized = locator.trim();
  if (!normalized) {
    throw new SelectorRegistryValidationError('locator must not be empty.');
  }

  if (normalized.length > 2048) {
    throw new SelectorRegistryValidationError('locator must be 2048 characters or less.');
  }

  return normalized;
}

function validateConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) {
    return undefined;
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new SelectorRegistryValidationError('confidence must be a number between 0 and 1.');
  }

  return Number(confidence.toFixed(3));
}

function validateOptionalText(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 512) {
    throw new SelectorRegistryValidationError(`${fieldName} must be 512 characters or less.`);
  }

  return normalized;
}

function validateRecordShape(record: SelectorRecord, key: string): SelectorRecord {
  const parsedDate = Date.parse(record.updatedAt);
  if (!Number.isFinite(parsedDate)) {
    throw new SelectorRegistryDataError('Selector record has invalid updatedAt value.', key);
  }

  if (!Number.isInteger(record.version) || record.version <= 0) {
    throw new SelectorRegistryDataError('Selector record version must be a positive integer.', key);
  }

  return {
    id: validateIdentifier(record.id, 'id'),
    pageObjectName: validateIdentifier(record.pageObjectName, 'pageObjectName'),
    actionType: validateIdentifier(record.actionType, 'actionType'),
    locator: validateLocator(record.locator),
    strategy: validateOptionalText(record.strategy, 'strategy'),
    confidence: validateConfidence(record.confidence),
    notes: validateOptionalText(record.notes, 'notes'),
    updatedAt: new Date(parsedDate).toISOString(),
    version: record.version,
  };
}

/** Selector registry backed by a key-value store. */
export class SelectorRegistryRepository {
  private readonly store: SelectorStore;
  private readonly namespaces: SelectorRegistryNamespaces;
  private readonly namespace: string;
  private readonly now: () => Date;

  constructor({
    store,
    namespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
    now = () => new Date(),
  }: {
    store: SelectorStore;
    namespace?: string;
    now?: () => Date;
  }) {
    this.store = store;
    this.namespaces = buildSelectorRegistryNamespaces(namespace);
    this.namespace = this.namespaces.active;
    this.now = now;
  }

  public getNamespaces(): SelectorRegistryNamespaces {
    return { ...this.namespaces };
  }

  public async get(id: string): Promise<SelectorRecord | null> {
    const key = this.keyFor(id);
    const payload = await this.store.get(key);
    if (payload === null) {
      return null;
    }

    return this.deserializeRecord(payload, key);
  }

  public async upsert(
    input: SelectorUpsertInput,
    options: SelectorUpsertOptions = {},
  ): Promise<SelectorRecord> {
    const normalizedInput = this.normalizeUpsertInput(input);
    const expectedVersion = validateExpectedVersion(options.expectedVersion);

    if (expectedVersion !== undefined && this.store.compareAndSet) {
      return this.upsertWithCompareAndSet(normalizedInput, expectedVersion);
    }

    return this.upsertWithLegacyStore(normalizedInput, expectedVersion);
  }

  public async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    const deletedCount = await this.store.del(this.keyFor(id));
    if (deletedCount > 0 && existing) {
      await this.store.del(this.indexKeyFor(existing));
    }
    return deletedCount > 0;
  }

  public async listByPageObject(pageObjectName: string): Promise<SelectorRecord[]> {
    const normalizedPageObjectName = validateIdentifier(pageObjectName, 'pageObjectName');
    const records = await this.listAll();
    return records
      .filter((record) => record.pageObjectName === normalizedPageObjectName)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public async listByPageObjectAndAction(
    pageObjectName: string,
    actionType: string,
    limit?: number,
  ): Promise<SelectorRecord[]> {
    const normalizedPageObjectName = validateIdentifier(pageObjectName, 'pageObjectName');
    const normalizedActionType = validateIdentifier(actionType, 'actionType');
    const boundedLimit = validateLookupLimit(limit);
    const indexKeys = await this.listIndexKeys(
      normalizedPageObjectName,
      normalizedActionType,
      boundedLimit,
    );

    if (indexKeys.length === 0) {
      const records = await this.listByPageObject(normalizedPageObjectName);
      return records
        .filter((record) => record.actionType === normalizedActionType)
        .slice(0, boundedLimit);
    }

    const recordKeys = (await this.loadRecordPayloads(indexKeys))
      .filter((payload): payload is string => typeof payload === 'string' && payload.length > 0)
      .slice(0, boundedLimit);
    const payloads = await this.loadRecordPayloads(recordKeys);
    const records: SelectorRecord[] = [];

    for (let index = 0; index < recordKeys.length; index += 1) {
      const payload = payloads[index];
      if (payload === null || payload === undefined) {
        continue;
      }
      const record = this.deserializeRecord(payload, recordKeys[index]);
      if (
        record.pageObjectName === normalizedPageObjectName &&
        record.actionType === normalizedActionType
      ) {
        records.push(record);
      }
    }

    return records.sort((left, right) => left.id.localeCompare(right.id)).slice(0, boundedLimit);
  }

  public async listAll(): Promise<SelectorRecord[]> {
    const keys = await this.listRecordKeys();
    const records: SelectorRecord[] = [];

    for (let index = 0; index < keys.length; index += DEFAULT_LIST_BATCH_SIZE) {
      const batchKeys = keys.slice(index, index + DEFAULT_LIST_BATCH_SIZE);
      const payloads = await this.loadRecordPayloads(batchKeys);
      for (let offset = 0; offset < batchKeys.length; offset += 1) {
        const payload = payloads[offset];
        if (payload === null || payload === undefined) {
          continue;
        }
        records.push(this.deserializeRecord(payload, batchKeys[offset]));
      }
    }

    return records;
  }

  private normalizeUpsertInput(input: SelectorUpsertInput): SelectorUpsertInput {
    return {
      id: validateIdentifier(input.id, 'id'),
      pageObjectName: validateIdentifier(input.pageObjectName, 'pageObjectName'),
      actionType: validateIdentifier(input.actionType, 'actionType'),
      locator: validateLocator(input.locator),
      strategy: validateOptionalText(input.strategy, 'strategy'),
      confidence: validateConfidence(input.confidence),
      notes: validateOptionalText(input.notes, 'notes'),
    };
  }

  private async upsertWithCompareAndSet(
    input: SelectorUpsertInput,
    expectedVersion: number | null,
  ): Promise<SelectorRecord> {
    const nextRecord = this.buildRecord(input, expectedVersion === null ? 1 : expectedVersion + 1);
    const key = this.keyFor(input.id);
    const result = await this.store.compareAndSet!(key, this.serializeRecord(nextRecord), {
      expectedVersion,
    });

    if (!result.written) {
      throw this.buildConflictError(input.id, expectedVersion, result.existingValue, key);
    }

    const existingRecord = result.existingValue
      ? this.deserializeRecord(result.existingValue, key)
      : null;
    await this.updateIndexes(nextRecord, existingRecord);
    return nextRecord;
  }

  private async upsertWithLegacyStore(
    input: SelectorUpsertInput,
    expectedVersion: number | null | undefined,
  ): Promise<SelectorRecord> {
    const existing = await this.get(input.id);
    this.assertExpectedVersion(input.id, expectedVersion, existing);

    const nextRecord = this.buildRecord(input, existing ? existing.version + 1 : 1);
    await this.store.set(this.keyFor(input.id), this.serializeRecord(nextRecord));
    await this.updateIndexes(nextRecord, existing);
    return nextRecord;
  }

  private buildRecord(input: SelectorUpsertInput, version: number): SelectorRecord {
    return {
      id: input.id,
      pageObjectName: input.pageObjectName,
      actionType: input.actionType,
      locator: input.locator,
      strategy: input.strategy,
      confidence: input.confidence,
      notes: input.notes,
      updatedAt: this.now().toISOString(),
      version,
    };
  }

  private assertExpectedVersion(
    id: string,
    expectedVersion: number | null | undefined,
    existing: SelectorRecord | null,
  ): void {
    if (expectedVersion === undefined) {
      return;
    }

    const actualVersion = existing?.version ?? null;
    if (expectedVersion === null ? existing !== null : actualVersion !== expectedVersion) {
      throw new SelectorRegistryConflictError(
        this.formatConflictMessage(id, expectedVersion, actualVersion),
        id,
        expectedVersion,
        actualVersion,
      );
    }
  }

  private buildConflictError(
    id: string,
    expectedVersion: number | null,
    existingValue: string | null,
    key: string,
  ): SelectorRegistryConflictError {
    const actualVersion = existingValue ? this.deserializeRecord(existingValue, key).version : null;
    return new SelectorRegistryConflictError(
      this.formatConflictMessage(id, expectedVersion, actualVersion),
      id,
      expectedVersion,
      actualVersion,
    );
  }

  private formatConflictMessage(
    id: string,
    expectedVersion: number | null,
    actualVersion: number | null,
  ): string {
    const expected = expectedVersion === null ? 'no existing record' : `version ${expectedVersion}`;
    const actual = actualVersion === null ? 'no existing record' : `version ${actualVersion}`;
    return `Selector ${id} expected ${expected} but found ${actual}.`;
  }

  private async updateIndexes(
    nextRecord: SelectorRecord,
    existingRecord: SelectorRecord | null,
  ): Promise<void> {
    const nextIndexKey = this.indexKeyFor(nextRecord);
    await this.store.set(nextIndexKey, this.keyFor(nextRecord.id));

    if (existingRecord) {
      const existingIndexKey = this.indexKeyFor(existingRecord);
      if (existingIndexKey !== nextIndexKey) {
        await this.store.del(existingIndexKey);
      }
    }
  }

  private async listRecordKeys(): Promise<string[]> {
    const pattern = `${this.namespace}:*`;
    const keys: string[] = [];
    if (this.store.scanKeys) {
      for await (const key of this.store.scanKeys(pattern)) {
        keys.push(key);
      }
    } else {
      keys.push(...(await this.store.keys(pattern)));
    }
    return keys.sort((left, right) => left.localeCompare(right));
  }

  private async listIndexKeys(
    pageObjectName: string,
    actionType: string,
    limit: number,
  ): Promise<string[]> {
    const pattern = `${this.namespaces.index}:${pageObjectName}:${actionType}:*`;
    const keys: string[] = [];
    if (this.store.scanKeys) {
      for await (const key of this.store.scanKeys(pattern)) {
        keys.push(key);
        if (keys.length >= limit) {
          break;
        }
      }
    } else {
      keys.push(...(await this.store.keys(pattern)));
    }
    return keys.sort((left, right) => left.localeCompare(right)).slice(0, limit);
  }

  private async loadRecordPayloads(keys: readonly string[]): Promise<Array<string | null>> {
    if (this.store.getMany) {
      return this.store.getMany(keys);
    }
    return Promise.all(keys.map((key) => this.store.get(key)));
  }

  private keyFor(id: string): string {
    return `${this.namespace}:${validateIdentifier(id, 'id')}`;
  }

  private indexKeyFor(record: SelectorRecord): string {
    return `${this.namespaces.index}:${record.pageObjectName}:${record.actionType}:${record.id}`;
  }

  private serializeRecord(record: SelectorRecord): string {
    return `${JSON.stringify(record)}\n`;
  }

  private deserializeRecord(payload: string, key: string): SelectorRecord {
    try {
      const parsed = JSON.parse(payload) as SelectorRecord;
      return validateRecordShape(parsed, key);
    } catch (error: unknown) {
      if (
        error instanceof SelectorRegistryDataError ||
        error instanceof SelectorRegistryValidationError
      ) {
        throw error;
      }
      throw new SelectorRegistryDataError('Failed to parse selector record payload.', key, error);
    }
  }
}
