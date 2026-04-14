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

export interface SelectorStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

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
  private readonly namespace: string;
  private readonly now: () => Date;

  constructor({
    store,
    namespace = 'selector-registry',
    now = () => new Date(),
  }: {
    store: SelectorStore;
    namespace?: string;
    now?: () => Date;
  }) {
    this.store = store;
    this.namespace = validateIdentifier(namespace, 'namespace');
    this.now = now;
  }

  public async get(id: string): Promise<SelectorRecord | null> {
    const key = this.keyFor(id);
    const payload = await this.store.get(key);
    if (payload === null) {
      return null;
    }

    return this.deserializeRecord(payload, key);
  }

  public async upsert(input: SelectorUpsertInput): Promise<SelectorRecord> {
    const normalizedId = validateIdentifier(input.id, 'id');
    const existing = await this.get(normalizedId);

    const nextRecord: SelectorRecord = {
      id: normalizedId,
      pageObjectName: validateIdentifier(input.pageObjectName, 'pageObjectName'),
      actionType: validateIdentifier(input.actionType, 'actionType'),
      locator: validateLocator(input.locator),
      strategy: validateOptionalText(input.strategy, 'strategy'),
      confidence: validateConfidence(input.confidence),
      notes: validateOptionalText(input.notes, 'notes'),
      updatedAt: this.now().toISOString(),
      version: existing ? existing.version + 1 : 1,
    };

    const key = this.keyFor(normalizedId);
    await this.store.set(key, `${JSON.stringify(nextRecord)}\n`);

    return nextRecord;
  }

  public async delete(id: string): Promise<boolean> {
    const deletedCount = await this.store.del(this.keyFor(id));
    return deletedCount > 0;
  }

  public async listByPageObject(pageObjectName: string): Promise<SelectorRecord[]> {
    const normalizedPageObjectName = validateIdentifier(pageObjectName, 'pageObjectName');
    const records = await this.listAll();
    return records
      .filter((record) => record.pageObjectName === normalizedPageObjectName)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public async listAll(): Promise<SelectorRecord[]> {
    const keys = await this.store.keys(`${this.namespace}:*`);
    const records: SelectorRecord[] = [];

    for (const key of keys.sort((left, right) => left.localeCompare(right))) {
      const payload = await this.store.get(key);
      if (payload === null) {
        continue;
      }
      records.push(this.deserializeRecord(payload, key));
    }

    return records;
  }

  private keyFor(id: string): string {
    return `${this.namespace}:${validateIdentifier(id, 'id')}`;
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
