import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import {
  SelectorRegistryRepository,
  type SelectorStore,
} from '../../../../../src/data/selectors/selectorRegistry';
import { RedisClient } from '../../../../../src/utils/redisClient';

interface IntegrationRuntime {
  container: StartedTestContainer | null;
  client: RedisClient | null;
  skipReason: string | null;
}

const runtime: IntegrationRuntime = {
  container: null,
  client: null,
  skipReason: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function requireClient(context: TestContext): RedisClient {
  if (runtime.skipReason || runtime.client === null) {
    context.skip(
      `Docker/Testcontainers is unavailable in this environment. ${runtime.skipReason ?? ''}`.trim(),
    );
  }

  if (runtime.client === null) {
    throw new Error('Redis integration runtime is unavailable.');
  }

  return runtime.client;
}

beforeAll(async () => {
  try {
    runtime.container = await new GenericContainer('redis:7.2-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .withStartupTimeout(120_000)
      .start();

    runtime.client = new RedisClient({
      env: {
        AURORAFLOW_REDIS_HOST: runtime.container.getHost(),
        AURORAFLOW_REDIS_PORT: String(runtime.container.getMappedPort(6379)),
        AURORAFLOW_REDIS_DB: '0',
        AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS: '5000',
        AURORAFLOW_REDIS_MAX_RETRIES: '2',
        AURORAFLOW_REDIS_BASE_BACKOFF_MS: '5',
        AURORAFLOW_REDIS_MAX_BACKOFF_MS: '100',
        AURORAFLOW_REDIS_KEY_PREFIX: 'auroraflow-int',
      },
    });

    await runtime.client.connect();
  } catch (error: unknown) {
    runtime.skipReason = toErrorMessage(error);
    if (runtime.client !== null) {
      await runtime.client.disconnect().catch(() => {});
      runtime.client = null;
    }
    if (runtime.container !== null) {
      await runtime.container.stop().catch(() => {});
      runtime.container = null;
    }
  }
});

afterAll(async () => {
  if (runtime.client !== null) {
    await runtime.client.disconnect();
    runtime.client = null;
  }

  if (runtime.container !== null) {
    await runtime.container.stop();
    runtime.container = null;
  }
});

describe('RedisClient integration', () => {
  it('round-trips values and key listings against a real Redis instance', async (context) => {
    const client = requireClient(context);

    await client.set('integration:user', '{"name":"aurora"}');
    const storedValue = await client.get('integration:user');
    const keys = await client.keys('integration:*');
    const deletedCount = await client.del('integration:user');
    const valueAfterDelete = await client.get('integration:user');

    expect(storedValue).toBe('{"name":"aurora"}');
    expect(keys).toContain('integration:user');
    expect(deletedCount).toBe(1);
    expect(valueAfterDelete).toBeNull();
  });

  it('stores and expires values when ttlSeconds is provided', async (context) => {
    const client = requireClient(context);

    await client.set('integration:ttl', 'temp', { ttlSeconds: 1 });
    expect(await client.get('integration:ttl')).toBe('temp');

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await client.get('integration:ttl')).toBeNull();
  });
});

describe('SelectorRegistryRepository integration', () => {
  it('persists versioned selector records and lists by page object', async (context) => {
    const client = requireClient(context);
    const store: SelectorStore = {
      get: (key: string) => client.get(key),
      set: (key: string, value: string) => client.set(key, value),
      del: (key: string) => client.del(key),
      keys: (pattern: string) => client.keys(pattern),
    };
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selector-registry-int',
      now: () => new Date('2026-04-14T00:00:00.000Z'),
    });

    const created = await repository.upsert({
      id: 'profile.menu',
      pageObjectName: 'ProfilePage',
      actionType: 'click',
      locator: "page.getByRole('button', { name: 'Profile' })",
      confidence: 0.91,
    });
    const updated = await repository.upsert({
      id: 'profile.menu',
      pageObjectName: 'ProfilePage',
      actionType: 'click',
      locator: "page.getByRole('button', { name: 'My Profile' })",
      confidence: 0.95,
    });

    const loaded = await repository.get('profile.menu');
    const byPageObject = await repository.listByPageObject('ProfilePage');
    const deleted = await repository.delete('profile.menu');

    expect(created.version).toBe(1);
    expect(updated.version).toBe(2);
    expect(loaded?.locator).toBe("page.getByRole('button', { name: 'My Profile' })");
    expect(byPageObject).toHaveLength(1);
    expect(byPageObject[0]?.id).toBe('profile.menu');
    expect(byPageObject[0]?.version).toBe(2);
    expect(deleted).toBe(true);
  });
});
