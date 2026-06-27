import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import {
  SelectorRegistryConflictError,
  SelectorRegistryRepository,
} from '../../../../../src/data/selectors/selectorRegistry';
import { createRedisSelectorStore } from '../../../../../src/data/selectors/redisSelectorStore';
import { StoreSelectorCandidateHistoryRepository } from '../../../../../src/framework/selfHealing/historyRepository';
import { StorePendingSelectorPromotionRepository } from '../../../../../src/framework/selfHealing/promotionRepository';
import { SelfHealingPromotionWorkflow } from '../../../../../src/framework/selfHealing/promotionWorkflow';
import type { RankedSelfHealingCandidate } from '../../../../../src/framework/selfHealing/types';
import { RedisClient } from '../../../../../src/utils/redisClient';
import { repairSelfHealingRegistry } from '../../../../../scripts/self-healing-registry-repair';
import { defineSelectorStoreConformanceSuite } from '../../../../helpers/selectorStoreConformance';

interface IntegrationRuntime {
  container: StartedTestContainer | null;
  client: RedisClient | null;
  skipReason: string | null;
  usesExternalRedis: boolean;
}

const runtime: IntegrationRuntime = {
  container: null,
  client: null,
  skipReason: null,
  usesExternalRedis: false,
};
const REQUIRED_ENV = 'AURORAFLOW_REDIS_INTEGRATION_REQUIRED';
const EXTERNAL_REDIS_ENV = 'AURORAFLOW_REDIS_INTEGRATION_EXTERNAL';
const CONTAINER_STARTUP_TIMEOUT_MS = 45_000;
const INTEGRATION_SETUP_TIMEOUT_MS = 120_000;
const concurrentHistoryCandidate: RankedSelfHealingCandidate = {
  id: 'candidate-concurrent-int',
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
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function redisIntegrationRequired(): boolean {
  return booleanEnv(REQUIRED_ENV);
}

function externalRedisIntegrationEnabled(): boolean {
  return booleanEnv(EXTERNAL_REDIS_ENV);
}

function booleanEnv(key: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[key] ?? '').trim().toLowerCase());
}

function redisUnavailableSource(): string {
  return runtime.usesExternalRedis ? 'external Redis' : 'Docker/Testcontainers';
}

function requireClient(context: TestContext): RedisClient {
  if (runtime.skipReason || runtime.client === null) {
    if (redisIntegrationRequired() || runtime.usesExternalRedis) {
      throw new Error(
        `Redis integration is required but unavailable: ${runtime.skipReason ?? 'unknown setup failure'}`,
      );
    }
    context.skip(`${redisUnavailableSource()} is unavailable. ${runtime.skipReason ?? ''}`.trim());
  }

  if (runtime.client === null) {
    throw new Error('Redis integration runtime is unavailable.');
  }

  return runtime.client;
}

function defaultIntegrationKeyPrefix(): string {
  return `auroraflow-int-${process.pid}-${Date.now().toString(36)}`;
}

function buildExternalRedisEnv(): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS: process.env.AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS ?? '5000',
    AURORAFLOW_REDIS_MAX_RETRIES: process.env.AURORAFLOW_REDIS_MAX_RETRIES ?? '2',
    AURORAFLOW_REDIS_BASE_BACKOFF_MS: process.env.AURORAFLOW_REDIS_BASE_BACKOFF_MS ?? '5',
    AURORAFLOW_REDIS_MAX_BACKOFF_MS: process.env.AURORAFLOW_REDIS_MAX_BACKOFF_MS ?? '100',
    AURORAFLOW_REDIS_KEY_PREFIX:
      process.env.AURORAFLOW_REDIS_KEY_PREFIX ?? defaultIntegrationKeyPrefix(),
  };
}

function buildContainerRedisEnv(
  container: StartedTestContainer,
): Readonly<Record<string, string | undefined>> {
  return {
    AURORAFLOW_REDIS_HOST: container.getHost(),
    AURORAFLOW_REDIS_PORT: String(container.getMappedPort(6379)),
    AURORAFLOW_REDIS_DB: '0',
    AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS: '5000',
    AURORAFLOW_REDIS_MAX_RETRIES: '2',
    AURORAFLOW_REDIS_BASE_BACKOFF_MS: '5',
    AURORAFLOW_REDIS_MAX_BACKOFF_MS: '100',
    AURORAFLOW_REDIS_KEY_PREFIX: defaultIntegrationKeyPrefix(),
  };
}

async function cleanupRuntimeKeys(client: RedisClient): Promise<void> {
  for (const key of await client.keys('*')) {
    await client.del(key);
  }
}

beforeAll(async () => {
  runtime.usesExternalRedis = externalRedisIntegrationEnabled();
  try {
    if (runtime.usesExternalRedis) {
      runtime.client = new RedisClient({ env: buildExternalRedisEnv() });
      await runtime.client.connect();
      await runtime.client.ping();
      return;
    }

    runtime.container = await new GenericContainer('redis:7.2-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();

    runtime.client = new RedisClient({ env: buildContainerRedisEnv(runtime.container) });

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
    if (redisIntegrationRequired() || runtime.usesExternalRedis) {
      throw new Error(
        `Redis integration is required but ${redisUnavailableSource()} setup failed: ${runtime.skipReason}`,
      );
    }
  }
}, INTEGRATION_SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (runtime.client !== null) {
    await cleanupRuntimeKeys(runtime.client).catch(() => {});
    await runtime.client.disconnect();
    runtime.client = null;
  }

  if (runtime.container !== null) {
    await runtime.container.stop();
    runtime.container = null;
  }
}, INTEGRATION_SETUP_TIMEOUT_MS);

defineSelectorStoreConformanceSuite('RedisSelectorStore', {
  create: (context) => {
    const client = requireClient(context);
    const store = createRedisSelectorStore(client);
    return {
      store,
      cleanup: async () => {
        for (const pattern of ['conformance:*', 'outside:conformance:*']) {
          for (const key of await store.keys(pattern)) {
            await store.del(key);
          }
        }
      },
    };
  },
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

  it(
    'authenticates to password-protected Redis and rejects wrong credentials',
    async (context) => {
      requireClient(context);
      let authContainer: StartedTestContainer | null = null;
      let authenticatedClient: RedisClient | null = null;
      let rejectedClient: RedisClient | null = null;

      try {
        authContainer = await new GenericContainer('redis:7.2-alpine')
          .withCommand(['redis-server', '--requirepass', 'aurora-e2e-password'])
          .withExposedPorts(6379)
          .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
          .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
          .start();

        authenticatedClient = new RedisClient({
          env: {
            AURORAFLOW_REDIS_HOST: authContainer.getHost(),
            AURORAFLOW_REDIS_PORT: String(authContainer.getMappedPort(6379)),
            AURORAFLOW_REDIS_PASSWORD: 'aurora-e2e-password',
            AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS: '5000',
            AURORAFLOW_REDIS_MAX_RETRIES: '1',
            AURORAFLOW_REDIS_BASE_BACKOFF_MS: '5',
            AURORAFLOW_REDIS_MAX_BACKOFF_MS: '50',
            AURORAFLOW_REDIS_KEY_PREFIX: 'auroraflow-auth-int',
          },
        });
        await authenticatedClient.connect();
        await authenticatedClient.set('auth:probe', 'ok');
        await expect(authenticatedClient.get('auth:probe')).resolves.toBe('ok');

        rejectedClient = new RedisClient({
          env: {
            AURORAFLOW_REDIS_HOST: authContainer.getHost(),
            AURORAFLOW_REDIS_PORT: String(authContainer.getMappedPort(6379)),
            AURORAFLOW_REDIS_PASSWORD: 'wrong-password',
            AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS: '5000',
            AURORAFLOW_REDIS_MAX_RETRIES: '0',
            AURORAFLOW_REDIS_BASE_BACKOFF_MS: '5',
            AURORAFLOW_REDIS_MAX_BACKOFF_MS: '50',
            AURORAFLOW_REDIS_KEY_PREFIX: 'auroraflow-auth-int',
          },
        });

        await expect(rejectedClient.connect()).rejects.toThrow(
          /Redis connect failed|NOAUTH|WRONGPASS/i,
        );
      } finally {
        await authenticatedClient?.disconnect().catch(() => {});
        await rejectedClient?.disconnect().catch(() => {});
        await authContainer?.stop().catch(() => {});
      }
    },
    INTEGRATION_SETUP_TIMEOUT_MS,
  );
});

describe('SelectorRegistryRepository integration', () => {
  it('upgrades legacy records and repairs Redis indexes after a dry-run', async (context) => {
    const client = requireClient(context);
    const store = createRedisSelectorStore(client);
    const namespace = 'selector-registry-repair-int';
    const activeKey = `${namespace}:legacy.submit`;
    const expectedIndexKey = `${namespace}-index:LegacyPage:click:legacy.submit`;
    const staleIndexKey = `${namespace}-index:OldPage:click:legacy.submit`;
    await store.set(
      activeKey,
      JSON.stringify({
        id: 'legacy.submit',
        pageObjectName: 'LegacyPage',
        actionType: 'click',
        locator: '#legacy-submit',
        updatedAt: '2026-05-01T12:00:00.000Z',
        version: 2,
      }),
    );
    await store.set(staleIndexKey, activeKey);

    await expect(
      repairSelfHealingRegistry({ store, activeNamespace: namespace }),
    ).resolves.toMatchObject({
      dryRun: true,
      legacyRecords: 1,
      missingIndexes: 1,
      staleIndexes: 1,
      recordsUpgraded: 0,
    });
    await expect(store.get(expectedIndexKey)).resolves.toBeNull();

    await expect(
      repairSelfHealingRegistry({ store, activeNamespace: namespace, dryRun: false }),
    ).resolves.toMatchObject({
      recordsUpgraded: 1,
      indexesCreated: 1,
      indexesDeleted: 1,
    });
    expect(JSON.parse((await store.get(activeKey)) ?? '{}')).toMatchObject({
      schemaVersion: '1.0.0',
      version: 2,
    });
    await expect(store.get(expectedIndexKey)).resolves.toBe(activeKey);
    await expect(store.get(staleIndexKey)).resolves.toBeNull();
    await store.del(activeKey);
    await store.del(expectedIndexKey);
  });

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
    expect(created.schemaVersion).toBe('1.0.0');
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

  it('preserves exact SAT history counters under concurrent Redis observations', async (context) => {
    const client = requireClient(context);
    const store = createRedisSelectorStore(client);
    const activeNamespace = 'selector-registry-history-concurrency-int';
    const historyRepository = new StoreSelectorCandidateHistoryRepository({
      store,
      activeNamespace,
    });
    const historyKey = `${activeNamespace}-history:${concurrentHistoryCandidate.id}`;
    const observationCount = 120;

    await store.del(historyKey);
    await Promise.all(
      Array.from({ length: observationCount }, async (_, index) =>
        historyRepository.recordObservation({
          candidate: concurrentHistoryCandidate,
          eventId: `evt-concurrent-int-${index}`,
          observedAt: '2026-06-08T12:00:00.000Z',
          selectorId: 'checkout.submit',
          validationStatus: index % 2 === 0 ? 'accepted' : 'no_matches',
          validationAccepted: index % 2 === 0,
          guardedApplySucceeded: index % 3 === 0,
          guardedApplyFailed: index % 5 === 0,
        }),
      ),
    );

    await expect(historyRepository.get(concurrentHistoryCandidate.id)).resolves.toMatchObject({
      candidateId: concurrentHistoryCandidate.id,
      attempts: observationCount,
      validated: 60,
      guardedApplySucceeded: 40,
      guardedApplyFailed: 24,
      expiresAt: '2026-07-08T12:00:00.000Z',
    });
    await store.del(historyKey);
  });

  it('approves, rejects, conflicts, and rolls back reviewed promotions', async (context) => {
    const client = requireClient(context);
    const store = createRedisSelectorStore(client);
    const workflow = new SelfHealingPromotionWorkflow({
      store,
      activeNamespace: 'selector-registry-review-int',
      now: () => new Date('2026-06-08T14:00:00.000Z'),
    });
    const repository = new SelectorRegistryRepository({
      store,
      namespace: 'selector-registry-review-int',
      now: () => new Date('2026-06-08T14:00:00.000Z'),
    });
    const promotionRepository = new StorePendingSelectorPromotionRepository({
      store,
      activeNamespace: 'selector-registry-review-int',
    });
    const historyRepository = new StoreSelectorCandidateHistoryRepository({
      store,
      activeNamespace: 'selector-registry-review-int',
    });

    await repository.upsert(
      {
        id: 'checkout.submit',
        pageObjectName: 'CheckoutPage',
        actionType: 'click',
        locator: '#submit',
        confidence: 0.42,
      },
      { expectedVersion: null },
    );
    await promotionRepository.upsert({
      promotionId: 'promotion:evt-int-approve:candidate',
      eventId: 'evt-int-approve',
      candidateId: 'candidate-approve',
      selectorId: 'checkout.submit',
      proposedLocator: '#submit-primary',
      locator: '#submit-primary',
      baseSelectorVersion: 1,
      confidence: 0.91,
      status: 'pending',
      requestedAt: '2026-06-08T13:30:00.000Z',
      acknowledged: false,
    });

    const applied = await workflow.approve({
      eventId: 'evt-int-approve',
      reviewer: 'ci-reviewer',
    });

    expect(applied.status).toBe('applied');
    await expect(repository.get('checkout.submit')).resolves.toMatchObject({
      locator: '#submit-primary',
      version: 2,
    });
    await expect(historyRepository.get('candidate-approve')).resolves.toMatchObject({
      promoted: 1,
      rejected: 0,
      rolledBack: 0,
    });

    await promotionRepository.upsert({
      promotionId: 'promotion:evt-int-reject:candidate',
      eventId: 'evt-int-reject',
      candidateId: 'candidate-reject',
      selectorId: 'checkout.submit',
      proposedLocator: '#submit-secondary',
      locator: '#submit-secondary',
      baseSelectorVersion: 2,
      confidence: 0.74,
      status: 'pending',
      requestedAt: '2026-06-08T13:31:00.000Z',
      acknowledged: false,
    });
    const rejected = await workflow.reject({
      eventId: 'evt-int-reject',
      reviewer: 'ci-reviewer',
      reason: 'False positive candidate.',
    });

    expect(rejected.status).toBe('rejected');
    await expect(historyRepository.get('candidate-reject')).resolves.toMatchObject({
      rejected: 1,
      rolledBack: 0,
    });

    await promotionRepository.upsert({
      promotionId: 'promotion:evt-int-conflict:candidate',
      eventId: 'evt-int-conflict',
      candidateId: 'candidate-conflict',
      selectorId: 'checkout.submit',
      proposedLocator: '#submit-tertiary',
      locator: '#submit-tertiary',
      baseSelectorVersion: 1,
      confidence: 0.88,
      status: 'pending',
      requestedAt: '2026-06-08T13:32:00.000Z',
      acknowledged: false,
    });
    const conflicted = await workflow.approve({
      eventId: 'evt-int-conflict',
      reviewer: 'ci-reviewer',
    });

    expect(conflicted.status).toBe('conflict');
    await expect(promotionRepository.get('evt-int-conflict')).resolves.toMatchObject({
      status: 'conflict',
    });

    const rolledBack = await workflow.rollback({
      eventId: 'evt-int-approve',
      reviewer: 'ci-reviewer',
      reason: 'Checkout regression.',
    });

    expect(rolledBack.status).toBe('rolled_back');
    await expect(repository.get('checkout.submit')).resolves.toMatchObject({
      locator: '#submit',
      version: 3,
    });
    await expect(historyRepository.get('candidate-approve')).resolves.toMatchObject({
      promoted: 1,
      rolledBack: 1,
    });
  });
});
