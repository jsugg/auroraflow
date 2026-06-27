import { describe, expect, it } from 'vitest';
import {
  SelectorRegistryConflictError,
  SelectorRegistryDataError,
  SelectorRegistryRepository,
  SelectorRegistryValidationError,
  SELECTOR_RECORD_SCHEMA_VERSION,
  buildSelectorRegistryNamespaces,
  type SelectorRecord,
  type SelectorStore,
  type SelectorStoreCompareAndSetOptions,
  type SelectorStoreCompareAndSetResult,
  type SelectorStoreSetOptions,
} from '../../../../../src/data/selectors/selectorRegistry';

class InMemorySelectorStore implements SelectorStore {
  protected readonly records = new Map<string, string>();
  public getCalls = 0;
  public getManyCalls = 0;
  public keysCalls = 0;
  public scanKeysCalls = 0;
  public readonly scanPatterns: string[] = [];
  public readonly setOptions: Array<SelectorStoreSetOptions | undefined> = [];

  public async get(key: string): Promise<string | null> {
    this.getCalls += 1;
    return this.records.get(key) ?? null;
  }

  public async getMany(keys: readonly string[]): Promise<Array<string | null>> {
    this.getManyCalls += 1;
    return keys.map((key) => this.records.get(key) ?? null);
  }

  public async set(key: string, value: string, options?: SelectorStoreSetOptions): Promise<void> {
    this.setOptions.push(options);
    this.records.set(key, value);
  }

  public async del(key: string): Promise<number> {
    const existed = this.records.delete(key);
    return existed ? 1 : 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    this.keysCalls += 1;
    const matcher = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return [...this.records.keys()].filter((key) => matcher.test(key));
  }

  public async *scanKeys(pattern: string): AsyncGenerator<string, void, void> {
    this.scanKeysCalls += 1;
    this.scanPatterns.push(pattern);
    for (const key of await this.keys(pattern)) {
      yield key;
    }
  }

  public rawSetUnsafe(key: string, value: string): void {
    this.records.set(key, value);
  }

  public rawGetUnsafe(key: string): string | undefined {
    return this.records.get(key);
  }

  public resetCounters(): void {
    this.getCalls = 0;
    this.getManyCalls = 0;
    this.keysCalls = 0;
    this.scanKeysCalls = 0;
    this.scanPatterns.length = 0;
  }
}

class CompareAndSetSelectorStore extends InMemorySelectorStore {
  public compareAndSetCalls = 0;

  public async compareAndSet(
    key: string,
    value: string,
    options: SelectorStoreCompareAndSetOptions,
  ): Promise<SelectorStoreCompareAndSetResult> {
    this.compareAndSetCalls += 1;
    const existingValue = this.records.get(key) ?? null;
    const existingVersion = existingValue ? readVersion(existingValue) : null;
    const matches =
      options.expectedVersion === null
        ? existingValue === null
        : existingVersion === options.expectedVersion;

    if (!matches) {
      return { written: false, existingValue };
    }

    await this.set(key, value, options);
    return { written: true, existingValue };
  }
}

function readVersion(payload: string): number | null {
  const parsed = JSON.parse(payload) as { version?: unknown };
  return typeof parsed.version === 'number' ? parsed.version : null;
}

describe('SelectorRegistryRepository', () => {
  it('upserts and increments selector versions', async () => {
    const store = new InMemorySelectorStore();
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selectors',
      now: () => new Date('2026-04-14T00:00:00.000Z'),
    });

    const first = await repository.upsert({
      id: 'login.button',
      pageObjectName: 'LoginPage',
      actionType: 'click',
      locator: "page.getByRole('button', { name: 'Login' })",
      confidence: 0.91,
    });

    expect(first).toMatchObject({
      schemaVersion: SELECTOR_RECORD_SCHEMA_VERSION,
      id: 'login.button',
      pageObjectName: 'LoginPage',
      actionType: 'click',
      version: 1,
      confidence: 0.91,
    });

    const second = await repository.upsert({
      id: 'login.button',
      pageObjectName: 'LoginPage',
      actionType: 'click',
      locator: "page.getByRole('button', { name: 'Sign In' })",
      confidence: 0.95,
    });

    expect(second.version).toBe(2);
    expect(second.locator).toContain('Sign In');

    const loaded = await repository.get('login.button');
    expect(loaded?.version).toBe(2);
    expect(loaded?.confidence).toBe(0.95);
    expect(loaded?.updatedAt).toBe('2026-04-14T00:00:00.000Z');
  });

  it('uses compare-and-set for explicit expected versions', async () => {
    const store = new CompareAndSetSelectorStore();
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selectors',
      now: () => new Date('2026-04-14T00:00:00.000Z'),
    });

    const created = await repository.upsert(
      {
        id: 'login.button',
        pageObjectName: 'LoginPage',
        actionType: 'click',
        locator: '#login',
      },
      { expectedVersion: null },
    );
    const updated = await repository.upsert(
      {
        id: 'login.button',
        pageObjectName: 'LoginPage',
        actionType: 'click',
        locator: '#sign-in',
      },
      { expectedVersion: 1 },
    );

    expect(created.version).toBe(1);
    expect(updated.version).toBe(2);
    expect(store.compareAndSetCalls).toBe(2);
  });

  it('rejects stale expected versions without overwriting active records', async () => {
    const store = new CompareAndSetSelectorStore();
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selectors',
    });

    await repository.upsert({
      id: 'login.button',
      pageObjectName: 'LoginPage',
      actionType: 'click',
      locator: '#login',
    });

    await expect(
      repository.upsert(
        {
          id: 'login.button',
          pageObjectName: 'LoginPage',
          actionType: 'click',
          locator: '#sign-in',
        },
        { expectedVersion: null },
      ),
    ).rejects.toMatchObject({
      name: 'SelectorRegistryConflictError',
      expectedVersion: null,
      actualVersion: 1,
    });

    await expect(
      repository.upsert(
        {
          id: 'login.button',
          pageObjectName: 'LoginPage',
          actionType: 'click',
          locator: '#sign-in',
        },
        { expectedVersion: 2 },
      ),
    ).rejects.toBeInstanceOf(SelectorRegistryConflictError);
    await expect(repository.get('login.button')).resolves.toMatchObject({
      locator: '#login',
      version: 1,
    });
  });

  it('keeps expected-version checks for legacy stores without CAS support', async () => {
    const store = new InMemorySelectorStore();
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selectors',
    });

    const created = await repository.upsert(
      {
        id: 'profile.link',
        pageObjectName: 'ProfilePage',
        actionType: 'click',
        locator: '#profile',
      },
      { expectedVersion: null },
    );
    const updated = await repository.upsert(
      {
        id: 'profile.link',
        pageObjectName: 'ProfilePage',
        actionType: 'click',
        locator: '#profile-updated',
      },
      { expectedVersion: 1 },
    );

    expect(created.version).toBe(1);
    expect(updated.version).toBe(2);
    await expect(
      repository.upsert(
        {
          id: 'profile.link',
          pageObjectName: 'ProfilePage',
          actionType: 'click',
          locator: '#stale',
        },
        { expectedVersion: 1 },
      ),
    ).rejects.toBeInstanceOf(SelectorRegistryConflictError);
  });

  it('lists records by page object name in deterministic order', async () => {
    const store = new InMemorySelectorStore();
    const repository = new SelectorRegistryRepository({ store, namespace: 'selectors' });

    await repository.upsert({
      id: 'b.field',
      pageObjectName: 'SettingsPage',
      actionType: 'type',
      locator: '#field-b',
    });
    await repository.upsert({
      id: 'a.field',
      pageObjectName: 'SettingsPage',
      actionType: 'type',
      locator: '#field-a',
    });
    await repository.upsert({
      id: 'other.field',
      pageObjectName: 'OtherPage',
      actionType: 'type',
      locator: '#other',
    });

    const getCallsBeforeList = store.getCalls;
    const records = await repository.listByPageObject('SettingsPage');
    expect(records.map((record: SelectorRecord) => record.id)).toEqual(['a.field', 'b.field']);
    expect(store.scanKeysCalls).toBe(1);
    expect(store.getManyCalls).toBe(1);
    expect(store.getCalls).toBe(getCallsBeforeList);
  });

  it('uses page/action index lookup without scanning active selector records', async () => {
    const store = new InMemorySelectorStore();
    const repository = new SelectorRegistryRepository({ store, namespace: 'selectors' });

    await repository.upsert({
      id: 'b.field',
      pageObjectName: 'SettingsPage',
      actionType: 'type',
      locator: '#field-b',
    });
    await repository.upsert({
      id: 'a.field',
      pageObjectName: 'SettingsPage',
      actionType: 'type',
      locator: '#field-a',
    });
    await repository.upsert({
      id: 'save.button',
      pageObjectName: 'SettingsPage',
      actionType: 'click',
      locator: '#save',
    });

    store.resetCounters();
    const records = await repository.listByPageObjectAndAction('SettingsPage', 'type');

    expect(records.map((record) => record.id)).toEqual(['a.field', 'b.field']);
    expect(store.scanPatterns).toEqual(['selectors-index:SettingsPage:type:*']);
    expect(store.getManyCalls).toBe(2);
    expect(store.getCalls).toBe(0);
  });

  it('deletes stale page/action index entries when indexed fields change', async () => {
    const store = new InMemorySelectorStore();
    const repository = new SelectorRegistryRepository({ store, namespace: 'selectors' });

    await repository.upsert({
      id: 'save.control',
      pageObjectName: 'SettingsPage',
      actionType: 'type',
      locator: '#save',
    });
    await repository.upsert({
      id: 'save.control',
      pageObjectName: 'SettingsPage',
      actionType: 'click',
      locator: '#save',
    });

    expect(store.rawGetUnsafe('selectors-index:SettingsPage:type:save.control')).toBeUndefined();
    await expect(repository.listByPageObjectAndAction('SettingsPage', 'click')).resolves.toEqual([
      expect.objectContaining({ id: 'save.control', actionType: 'click' }),
    ]);
  });

  it('keeps non-active keyspaces distinct from active selector listing', async () => {
    const store = new InMemorySelectorStore();
    const repository = new SelectorRegistryRepository({ store, namespace: 'selectors' });
    const namespaces = repository.getNamespaces();

    expect(namespaces).toEqual(buildSelectorRegistryNamespaces('selectors'));
    store.rawSetUnsafe(`${namespaces.history}:candidate`, '{"candidateId":"candidate"}');
    store.rawSetUnsafe(`${namespaces.promotions}:promotion`, '{"candidateId":"candidate"}');
    store.rawSetUnsafe(`${namespaces.audit}:event`, '{"selectorId":"selector"}');
    await repository.upsert({
      id: 'save.button',
      pageObjectName: 'SettingsPage',
      actionType: 'click',
      locator: '#save',
    });

    await expect(repository.listAll()).resolves.toHaveLength(1);
  });

  it('rejects invalid confidence and empty locators', async () => {
    const repository = new SelectorRegistryRepository({
      store: new InMemorySelectorStore(),
      namespace: 'selectors',
    });

    await expect(
      repository.upsert({
        id: 'save.button',
        pageObjectName: 'EditorPage',
        actionType: 'click',
        locator: '   ',
      }),
    ).rejects.toThrow(SelectorRegistryValidationError);

    await expect(
      repository.upsert({
        id: 'save.button',
        pageObjectName: 'EditorPage',
        actionType: 'click',
        locator: '#save',
        confidence: 1.1,
      }),
    ).rejects.toThrow(SelectorRegistryValidationError);
  });

  it('throws data errors for malformed stored payloads', async () => {
    const store = new InMemorySelectorStore();
    store.rawSetUnsafe('selectors:broken', '{"id":"broken"');

    const repository = new SelectorRegistryRepository({ store, namespace: 'selectors' });

    await expect(repository.get('broken')).rejects.toThrow(SelectorRegistryDataError);
  });

  it('reads unversioned legacy records and rejects unknown future schemas', async () => {
    const store = new InMemorySelectorStore();
    store.rawSetUnsafe(
      'selectors:legacy',
      JSON.stringify({
        id: 'legacy',
        pageObjectName: 'LegacyPage',
        actionType: 'click',
        locator: '#legacy',
        updatedAt: '2026-05-01T12:00:00.000Z',
        version: 2,
      }),
    );
    store.rawSetUnsafe(
      'selectors:future',
      JSON.stringify({
        schemaVersion: '2.0.0',
        id: 'future',
        pageObjectName: 'FuturePage',
        actionType: 'click',
        locator: '#future',
        updatedAt: '2026-06-01T12:00:00.000Z',
        version: 1,
      }),
    );
    const repository = new SelectorRegistryRepository({ store, namespace: 'selectors' });

    await expect(repository.get('legacy')).resolves.toMatchObject({
      schemaVersion: SELECTOR_RECORD_SCHEMA_VERSION,
      id: 'legacy',
      version: 2,
    });
    await expect(repository.get('future')).rejects.toThrow(
      'Unsupported selector record schemaVersion: 2.0.0.',
    );
  });

  it('deletes existing records and reports deletion status', async () => {
    const repository = new SelectorRegistryRepository({
      store: new InMemorySelectorStore(),
      namespace: 'selectors',
    });

    await repository.upsert({
      id: 'profile.link',
      pageObjectName: 'ProfilePage',
      actionType: 'click',
      locator: '#profile-link',
    });

    await expect(repository.delete('profile.link')).resolves.toBe(true);
    await expect(repository.delete('profile.link')).resolves.toBe(false);
  });
});
