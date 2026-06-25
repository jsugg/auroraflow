import type {
  SelectorStore,
  SelectorStoreCompareAndSetJsonFieldOptions,
  SelectorStoreCompareAndSetOptions,
  SelectorStoreCompareAndSetResult,
  SelectorStoreJsonMergePatch,
  SelectorStoreJsonObject,
  SelectorStoreJsonPrimitive,
  SelectorStoreSetOptions,
} from './selectorRegistry';

const MAX_TTL_SECONDS = 2_592_000;
const SUPPORTED_KEY_PATTERN = /^[a-zA-Z0-9:*._-]+$/;
const SUPPORTED_JSON_FIELD_PATTERN = /^[A-Za-z0-9_.:-]+$/;

interface MemoryStoreEntry {
  value: string;
  expiresAtMs: number | null;
}

export type MemorySelectorStoreDurability = 'non-durable';

export interface MemorySelectorStoreOptions {
  /**
   * Returns current epoch milliseconds. Intended for deterministic TTL tests.
   */
  now?: () => number;
}

export class MemorySelectorStore implements SelectorStore {
  public readonly durability: MemorySelectorStoreDurability = 'non-durable';

  private readonly records = new Map<string, MemoryStoreEntry>();
  private readonly now: () => number;
  private closed = false;

  public constructor(options: MemorySelectorStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  public async get(key: string): Promise<string | null> {
    return this.readLiveEntry(this.normalizeKey(key))?.value ?? null;
  }

  public async getMany(keys: readonly string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.readLiveEntry(this.normalizeKey(key))?.value ?? null);
  }

  public async set(
    key: string,
    value: string,
    options: SelectorStoreSetOptions = {},
  ): Promise<void> {
    this.records.set(this.normalizeKey(key), {
      value,
      expiresAtMs: this.resolveExpiresAtMs(options.ttlSeconds),
    });
  }

  public async compareAndSet(
    key: string,
    value: string,
    options: SelectorStoreCompareAndSetOptions,
  ): Promise<SelectorStoreCompareAndSetResult> {
    const normalizedKey = this.normalizeKey(key);
    const existingValue = this.readLiveEntry(normalizedKey)?.value ?? null;
    const existingVersion = existingValue === null ? null : this.readStoredVersion(existingValue);
    const expectedVersion = this.normalizeExpectedVersion(options.expectedVersion);
    const matches =
      expectedVersion === null ? existingValue === null : existingVersion === expectedVersion;

    if (!matches) {
      return { written: false, existingValue };
    }

    this.records.set(normalizedKey, {
      value,
      expiresAtMs: this.resolveExpiresAtMs(options.ttlSeconds),
    });
    return { written: true, existingValue };
  }

  public async compareAndSetJsonField(
    key: string,
    value: string,
    options: SelectorStoreCompareAndSetJsonFieldOptions,
  ): Promise<SelectorStoreCompareAndSetResult> {
    const normalizedKey = this.normalizeKey(key);
    const existingValue = this.readLiveEntry(normalizedKey)?.value ?? null;
    if (existingValue === null) {
      return { written: false, existingValue };
    }

    const fieldName = this.validateJsonFieldName(options.fieldName, 'compareAndSetJsonField');
    const expectedValue = this.validateJsonPrimitive(
      options.expectedValue,
      `compareAndSetJsonField.${fieldName}`,
    );
    const existingRecord = this.parseStoredJsonObject(existingValue);
    if (existingRecord[fieldName] !== expectedValue) {
      return { written: false, existingValue };
    }

    this.records.set(normalizedKey, {
      value,
      expiresAtMs: this.resolveExpiresAtMs(options.ttlSeconds),
    });
    return { written: true, existingValue };
  }

  public async atomicJsonMerge(
    key: string,
    patch: SelectorStoreJsonMergePatch,
    options: SelectorStoreSetOptions = {},
  ): Promise<string> {
    const normalizedKey = this.normalizeKey(key);
    const current = this.readLiveEntry(normalizedKey)?.value;
    const record =
      current === undefined
        ? { ...this.validateJsonObject(patch.defaultValue, 'defaultValue') }
        : this.parseStoredJsonObject(current);
    const defaults = this.validateJsonObject(patch.defaultValue, 'defaultValue');
    const set = this.validateJsonObject(patch.set ?? {}, 'set');

    for (const [fieldName, fieldValue] of Object.entries(defaults)) {
      if (!(fieldName in record)) {
        record[fieldName] = fieldValue;
      }
    }

    for (const [fieldName, increment] of Object.entries(patch.increments ?? {})) {
      this.validateJsonFieldName(fieldName, 'increments');
      if (!Number.isInteger(increment)) {
        throw new Error(`atomicJsonMerge increments.${fieldName} must be an integer.`);
      }

      const currentValue = record[fieldName];
      if (currentValue !== undefined && typeof currentValue !== 'number') {
        throw new Error('atomicJsonMerge counter field must be numeric.');
      }
      record[fieldName] = (currentValue ?? 0) + increment;
    }

    for (const [fieldName, fieldValue] of Object.entries(set)) {
      record[fieldName] = fieldValue;
    }

    const serialized = JSON.stringify(record);
    this.records.set(normalizedKey, {
      value: serialized,
      expiresAtMs: this.resolveExpiresAtMs(options.ttlSeconds),
    });
    return serialized;
  }

  public async del(key: string): Promise<number> {
    const normalizedKey = this.normalizeKey(key);
    const existed = this.readLiveEntry(normalizedKey) !== undefined;
    this.records.delete(normalizedKey);
    return existed ? 1 : 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    const matcher = this.patternToRegExp(this.normalizePattern(pattern));
    const matchedKeys: string[] = [];
    for (const key of this.records.keys()) {
      if (this.readLiveEntry(key) !== undefined && matcher.test(key)) {
        matchedKeys.push(key);
      }
    }
    return matchedKeys.sort((left, right) => left.localeCompare(right));
  }

  public async *scanKeys(pattern: string): AsyncGenerator<string, void, void> {
    for (const key of await this.keys(pattern)) {
      yield key;
    }
  }

  public clear(): void {
    this.assertOpen();
    this.records.clear();
  }

  public async close(): Promise<void> {
    this.records.clear();
    this.closed = true;
  }

  private normalizeKey(key: string): string {
    this.assertOpen();
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error('Memory selector store key must not be empty.');
    }
    if (!SUPPORTED_KEY_PATTERN.test(normalizedKey)) {
      throw new Error('Memory selector store key contains unsupported characters.');
    }
    return normalizedKey;
  }

  private normalizePattern(pattern: string): string {
    this.assertOpen();
    const normalizedPattern = pattern.trim();
    if (!SUPPORTED_KEY_PATTERN.test(normalizedPattern)) {
      throw new Error('Memory selector store pattern contains unsupported characters.');
    }
    return normalizedPattern;
  }

  private readLiveEntry(key: string): MemoryStoreEntry | undefined {
    this.assertOpen();
    const entry = this.records.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.now()) {
      this.records.delete(key);
      return undefined;
    }
    return entry;
  }

  private resolveExpiresAtMs(ttlSeconds: number | undefined): number | null {
    if (ttlSeconds === undefined) {
      return null;
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error('ttlSeconds must be an integer between 1 and 2592000.');
    }
    return this.now() + ttlSeconds * 1_000;
  }

  private normalizeExpectedVersion(expectedVersion: number | null): number | null {
    if (expectedVersion === null) {
      return null;
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new Error('expectedVersion must be a non-negative integer or null.');
    }
    return expectedVersion;
  }

  private readStoredVersion(payload: string): number | null {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      const version = (parsed as { version?: unknown }).version;
      return typeof version === 'number' && Number.isFinite(version) ? version : null;
    } catch {
      return null;
    }
  }

  private parseStoredJsonObject(payload: string): Record<string, SelectorStoreJsonPrimitive> {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('atomicJsonMerge target must contain a JSON object.');
    }
    return { ...this.validateJsonObject(parsed, 'target') };
  }

  private validateJsonObject(value: unknown, label: string): SelectorStoreJsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`atomicJsonMerge ${label} must be a JSON object.`);
    }

    const record: Record<string, SelectorStoreJsonPrimitive> = {};
    for (const [fieldName, fieldValue] of Object.entries(value)) {
      this.validateJsonFieldName(fieldName, label);
      if (
        fieldValue === null ||
        typeof fieldValue === 'string' ||
        typeof fieldValue === 'boolean' ||
        (typeof fieldValue === 'number' && Number.isFinite(fieldValue))
      ) {
        record[fieldName] = fieldValue;
        continue;
      }
      throw new Error(`atomicJsonMerge ${label}.${fieldName} must be a JSON primitive.`);
    }

    return record;
  }

  private validateJsonPrimitive(
    value: SelectorStoreJsonPrimitive,
    label: string,
  ): SelectorStoreJsonPrimitive {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return value;
    }
    throw new Error(`${label} must be a JSON primitive.`);
  }

  private validateJsonFieldName(fieldName: string, label: string): string {
    if (!SUPPORTED_JSON_FIELD_PATTERN.test(fieldName)) {
      throw new Error(`atomicJsonMerge ${label} contains unsupported field name.`);
    }
    return fieldName;
  }

  private patternToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'u');
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Memory selector store is closed.');
    }
  }
}

export function createMemorySelectorStore(
  options: MemorySelectorStoreOptions = {},
): MemorySelectorStore {
  return new MemorySelectorStore(options);
}
