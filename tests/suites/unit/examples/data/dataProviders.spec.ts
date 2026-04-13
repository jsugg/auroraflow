import { describe, expect, it, vi } from 'vitest';
import { InMemoryDataProvider } from '../../../../../examples/data/in-memory-data-provider';
import { RedisDataProvider } from '../../../../../examples/data/redis-data-provider';

describe('InMemoryDataProvider', () => {
  it('stores, retrieves, and deletes records deterministically', async () => {
    const provider = new InMemoryDataProvider<{ selector: string }>();

    await provider.set('login.button', { selector: '[data-testid="login"]' });
    await provider.set('profile.menu', { selector: '[data-testid="profile-menu"]' });

    await expect(provider.get('login.button')).resolves.toEqual({
      selector: '[data-testid="login"]',
    });
    await expect(provider.keys()).resolves.toEqual(['login.button', 'profile.menu']);

    await provider.delete('login.button');
    await expect(provider.get('login.button')).resolves.toBeNull();
    await expect(provider.keys()).resolves.toEqual(['profile.menu']);
  });
});

describe('RedisDataProvider', () => {
  it('namespaces keys and serializes values for redis storage', async () => {
    const get = vi.fn<() => Promise<string | null>>().mockResolvedValue('{"selector":"#save"}');
    const set = vi.fn<() => Promise<void>>().mockResolvedValue();
    const del = vi.fn<() => Promise<number>>().mockResolvedValue(1);
    const keys = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValue(['selectors:login.button', 'selectors:profile.menu']);

    const provider = new RedisDataProvider<{ selector: string }>({
      client: { get, set, del, keys },
      namespace: 'selectors',
    });

    await provider.set('login.button', { selector: '#save' });
    await expect(provider.get('login.button')).resolves.toEqual({ selector: '#save' });
    await expect(provider.keys()).resolves.toEqual(['login.button', 'profile.menu']);
    await provider.delete('login.button');

    expect(set).toHaveBeenCalledWith('selectors:login.button', '{"selector":"#save"}');
    expect(get).toHaveBeenCalledWith('selectors:login.button');
    expect(keys).toHaveBeenCalledWith('selectors:*');
    expect(del).toHaveBeenCalledWith('selectors:login.button');
  });

  it('returns null when redis payload is absent or invalid JSON', async () => {
    const providerMissing = new RedisDataProvider<{ selector: string }>({
      client: {
        get: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
        set: vi.fn<() => Promise<void>>().mockResolvedValue(),
        del: vi.fn<() => Promise<number>>().mockResolvedValue(0),
        keys: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
      },
      namespace: 'selectors',
    });

    await expect(providerMissing.get('missing')).resolves.toBeNull();

    const providerInvalid = new RedisDataProvider<{ selector: string }>({
      client: {
        get: vi.fn<() => Promise<string | null>>().mockResolvedValue('{not-json'),
        set: vi.fn<() => Promise<void>>().mockResolvedValue(),
        del: vi.fn<() => Promise<number>>().mockResolvedValue(0),
        keys: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
      },
      namespace: 'selectors',
    });

    await expect(providerInvalid.get('broken')).resolves.toBeNull();
  });
});
