import { describe, expect, it } from 'vitest';
import {
  SelectorRegistryDataError,
  SelectorRegistryRepository,
  SelectorRegistryValidationError,
  type SelectorRecord,
  type SelectorStore,
} from '../../../../../src/data/selectors/selectorRegistry';

class InMemorySelectorStore implements SelectorStore {
  private readonly records = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.records.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<void> {
    this.records.set(key, value);
  }

  public async del(key: string): Promise<number> {
    const existed = this.records.delete(key);
    return existed ? 1 : 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    const matcher = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return [...this.records.keys()].filter((key) => matcher.test(key));
  }

  public rawSetUnsafe(key: string, value: string): void {
    this.records.set(key, value);
  }
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

    const records = await repository.listByPageObject('SettingsPage');
    expect(records.map((record: SelectorRecord) => record.id)).toEqual(['a.field', 'b.field']);
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
