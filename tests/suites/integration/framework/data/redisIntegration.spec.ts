import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import {
  SelectorRegistryConflictError,
  SelectorRegistryRepository,
} from '../../../../../src/data/selectors/selectorRegistry';
import { createRedisSelectorStore } from '../../../../../src/data/selectors/redisSelectorStore';
import { StoreSelectorCandidateHistoryRepository } from '../../../../../src/framework/selfHealing/historyRepository';
import { StorePendingSelectorPromotionRepository } from '../../../../../src/framework/selfHealing/promotionRepository';
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
const CONTAINER_STARTUP_TIMEOUT_MS = 45_000;
const INTEGRATION_SETUP_TIMEOUT_MS = 60_000;

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
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
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
}, INTEGRATION_SETUP_TIMEOUT_MS);

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
    await client.set('integration:settings', '{"theme":"dark"}');
    const storedValue = await client.get('integration:user');
    const keys = await client.keys('integration:*');
    const storedValues = await client.mget(['integration:user', 'integration:settings']);
    const deletedCount = await client.del('integration:user');
    await client.del('integration:settings');
    const valueAfterDelete = await client.get('integration:user');

    expect(storedValue).toBe('{"name":"aurora"}');
    expect(keys).toContain('integration:user');
    expect(keys).toContain('integration:settings');
    expect(storedValues).toEqual(['{"name":"aurora"}', '{"theme":"dark"}']);
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
    const store = createRedisSelectorStore(client);
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

  it('prevents concurrent expected-version overwrites with Redis CAS', async (context) => {
    const client = requireClient(context);
    const repository = new SelectorRegistryRepository({
      store: createRedisSelectorStore(client),
      namespace: 'selector-registry-cas-int',
    });

    await repository.upsert(
      {
        id: 'checkout.submit',
        pageObjectName: 'CheckoutPage',
        actionType: 'click',
        locator: '#submit',
      },
      { expectedVersion: null },
    );

    const results = await Promise.allSettled([
      repository.upsert(
        {
          id: 'checkout.submit',
          pageObjectName: 'CheckoutPage',
          actionType: 'click',
          locator: '#submit-primary',
        },
        { expectedVersion: 1 },
      ),
      repository.upsert(
        {
          id: 'checkout.submit',
          pageObjectName: 'CheckoutPage',
          actionType: 'click',
          locator: '#submit-secondary',
        },
        { expectedVersion: 1 },
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    const loaded = await repository.get('checkout.submit');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(SelectorRegistryConflictError);
    expect(loaded?.version).toBe(2);
    await repository.delete('checkout.submit');
  });

  it('uses Redis-backed page/action indexes and isolated TTL keyspaces', async (context) => {
    const client = requireClient(context);
    const store = createRedisSelectorStore(client);
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selector-registry-index-int',
    });
    const namespaces = repository.getNamespaces();

    await repository.upsert({
      id: 'settings.field',
      pageObjectName: 'SettingsPage',
      actionType: 'type',
      locator: '#settings-field',
    });
    await store.set(`${namespaces.history}:candidate`, '{"candidateId":"candidate"}', {
      ttlSeconds: 1,
    });
    await store.set(`${namespaces.promotions}:promotion`, '{"candidateId":"candidate"}', {
      ttlSeconds: 1,
    });

    const indexed = await repository.listByPageObjectAndAction('SettingsPage', 'type');
    expect(indexed.map((record) => record.id)).toEqual(['settings.field']);
    expect(await store.get(`${namespaces.history}:candidate`)).toBe('{"candidateId":"candidate"}');
    expect(await store.get(`${namespaces.promotions}:promotion`)).toBe(
      '{"candidateId":"candidate"}',
    );

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await store.get(`${namespaces.history}:candidate`)).toBeNull();
    expect(await store.get(`${namespaces.promotions}:promotion`)).toBeNull();
    await expect(repository.listAll()).resolves.toHaveLength(1);
    await repository.delete('settings.field');
  });

  it('persists SAT history and pending promotion records with Redis TTLs', async (context) => {
    const client = requireClient(context);
    const store = createRedisSelectorStore(client);
    const historyRepository = new StoreSelectorCandidateHistoryRepository({
      store,
      activeNamespace: 'selector-registry-sat-int',
      ttlSeconds: 1,
    });
    const promotionRepository = new StorePendingSelectorPromotionRepository({
      store,
      activeNamespace: 'selector-registry-sat-int',
    });
    const observedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1_000).toISOString();

    const history = await historyRepository.recordObservation({
      candidate: {
        id: 'candidate-int',
        locator: '#submit',
        strategy: 'cssFallback',
        score: 0.8,
        rationale: 'CSS fallback candidate.',
        signals: {
          roleSignal: 0,
          accessibleNameSignal: 0,
          uniquenessSignal: 1,
          historicalSignal: 0,
          similaritySignal: 0.5,
        },
        evidence: {
          source: 'heuristic',
          uniqueInSnapshot: true,
          visible: true,
          matchedAttributes: [],
        },
      },
      eventId: 'evt-int',
      observedAt,
      selectorId: 'checkout.submit',
      validationStatus: 'accepted',
      validationAccepted: true,
      guardedApplySucceeded: true,
    });
    await promotionRepository.upsert({
      promotionId: 'promotion:evt-int:candidate',
      eventId: 'evt-int',
      candidateId: 'candidate-int',
      selectorId: 'checkout.submit',
      proposedLocator: '#submit',
      locator: '#submit',
      baseSelectorVersion: 2,
      confidence: 0.8,
      status: 'pending',
      requestedAt: observedAt,
      expiresAt,
      acknowledged: false,
    });

    expect(history).toMatchObject({
      candidateId: 'candidate-int',
      attempts: 1,
      validated: 1,
      guardedApplySucceeded: 1,
    });
    await expect(historyRepository.get('candidate-int')).resolves.toMatchObject({
      candidateId: 'candidate-int',
      attempts: 1,
    });
    await expect(promotionRepository.get('evt-int')).resolves.toMatchObject({
      promotionId: 'promotion:evt-int:candidate',
      selectorId: 'checkout.submit',
      status: 'pending',
    });

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(historyRepository.get('candidate-int')).resolves.toBeNull();
    await expect(promotionRepository.get('evt-int')).resolves.toBeNull();
  });
});
