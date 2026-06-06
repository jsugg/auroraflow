import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import {
  RedisClient,
  RedisConfigError,
  RedisOperationError,
  resolveRedisRuntimeConfig,
  type RedisClientDriver,
} from '../../../../../src/utils/redisClient';
import { CapturingTelemetry } from '../observability/capturingTelemetry';

type ErrorListener = (error: Error) => void;

class FakeRedisDriver implements RedisClientDriver {
  public isOpen = false;
  public isReady = false;
  public readonly connect = vi.fn(async () => {
    this.isOpen = true;
    this.isReady = true;
  });
  public readonly quit = vi.fn(async () => {
    this.isOpen = false;
    this.isReady = false;
    return 'OK';
  });
  public readonly disconnect = vi.fn(async () => {
    this.isOpen = false;
    this.isReady = false;
  });
  public readonly ping = vi.fn(async () => 'PONG');
  public readonly get: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>> = vi.fn(
    async (key: string) => {
      void key;
      return null;
    },
  );
  public readonly set = vi.fn(async (key: string, value: string) => {
    void key;
    void value;
    return 'OK';
  });
  public readonly del = vi.fn(async (key: string) => {
    void key;
    return 0;
  });
  public readonly mGet = vi.fn(async (keys: string[]) => {
    void keys;
    return [] as Array<string | null>;
  });
  public readonly scanIterator: ReturnType<
    typeof vi.fn<(options: { MATCH: string; COUNT?: number }) => AsyncIterable<string | string[]>>
  > = vi.fn((options: { MATCH: string; COUNT?: number }) => {
    void options;
    return (async function* scanEmpty(): AsyncGenerator<string | string[], void, void> {})();
  });

  private readonly listeners: ErrorListener[] = [];

  public on(event: 'error', listener: ErrorListener): void {
    if (event === 'error') {
      this.listeners.push(listener);
    }
  }

  public emitError(error: Error): void {
    for (const listener of this.listeners) {
      listener(error);
    }
  }
}

describe('resolveRedisRuntimeConfig', () => {
  it('returns default config values when env is empty', () => {
    const config = resolveRedisRuntimeConfig({});

    expect(config).toEqual({
      url: undefined,
      host: '127.0.0.1',
      port: 6379,
      username: undefined,
      password: undefined,
      database: 0,
      tls: false,
      connectTimeoutMs: 5000,
      maxRetries: 3,
      baseBackoffMs: 50,
      maxBackoffMs: 2000,
      keyPrefix: 'auroraflow',
    });
  });

  it('throws for invalid port values', () => {
    expect(() =>
      resolveRedisRuntimeConfig({
        AURORAFLOW_REDIS_PORT: 'invalid',
      }),
    ).toThrow(RedisConfigError);
  });

  it('accepts redis URL and explicit key prefix', () => {
    const config = resolveRedisRuntimeConfig({
      AURORAFLOW_REDIS_URL: 'redis://localhost:6380/2',
      AURORAFLOW_REDIS_KEY_PREFIX: 'selectors-v1',
    });

    expect(config.url).toBe('redis://localhost:6380/2');
    expect(config.keyPrefix).toBe('selectors-v1');
  });
});

describe('RedisClient', () => {
  let fakeDriver: FakeRedisDriver;

  beforeEach(() => {
    fakeDriver = new FakeRedisDriver();
  });

  afterEach(() => {
    resetTelemetryForTests();
  });

  it('retries transient failures and eventually succeeds', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    const sleepDurations: number[] = [];
    let getCallCount = 0;

    fakeDriver.get.mockImplementation(async (key: string) => {
      getCallCount += 1;
      if (getCallCount < 3) {
        throw new Error(`Transient failure ${getCallCount}`);
      }
      return key;
    });

    const client = new RedisClient({
      config: {
        host: '127.0.0.1',
        port: 6379,
        database: 0,
        tls: false,
        connectTimeoutMs: 1000,
        maxRetries: 3,
        baseBackoffMs: 10,
        maxBackoffMs: 100,
        keyPrefix: 'aurora',
      },
      createClient: () => fakeDriver,
      sleep: async (ms: number) => {
        sleepDurations.push(ms);
      },
      random: () => 0,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    });

    const value = await client.get('selectors:login.button');

    expect(value).toBe('aurora:selectors:login.button');
    expect(fakeDriver.connect).toHaveBeenCalledTimes(1);
    expect(fakeDriver.get).toHaveBeenCalledTimes(3);
    expect(sleepDurations).toEqual([10, 20]);

    const getSpan = telemetry.spans.find(
      (span) => span.attributes['auroraflow.redis.operation'] === 'get',
    );
    expect(getSpan?.status).toEqual({ code: 'ok' });
    expect(getSpan?.attributes).toMatchObject({
      'auroraflow.redis.operation.status': 'succeeded',
      'auroraflow.redis.operation.attempts': 3,
      'auroraflow.redis.operation.retries': 2,
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.redisOperationsTotal,
      value: 1,
      attributes: {
        'auroraflow.redis.operation': 'get',
        'auroraflow.redis.operation.status': 'succeeded',
      },
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.redisOperationRetriesTotal,
      value: 2,
      attributes: {
        'auroraflow.redis.operation': 'get',
        'auroraflow.redis.operation.status': 'succeeded',
      },
    });
    expect(telemetry.histograms).toContainEqual(
      expect.objectContaining({
        name: METRIC_NAMES.redisOperationDurationMs,
        attributes: {
          'auroraflow.redis.operation': 'get',
          'auroraflow.redis.operation.status': 'succeeded',
        },
      }),
    );
  });

  it('throws RedisOperationError after retry exhaustion', async () => {
    const telemetry = new CapturingTelemetry();
    setTelemetryForTests(telemetry);
    fakeDriver.set.mockRejectedValue(new Error('persistent set failure'));

    const client = new RedisClient({
      config: {
        host: '127.0.0.1',
        port: 6379,
        database: 0,
        tls: false,
        connectTimeoutMs: 1000,
        maxRetries: 2,
        baseBackoffMs: 5,
        maxBackoffMs: 10,
        keyPrefix: 'aurora',
      },
      createClient: () => fakeDriver,
      sleep: async () => {},
      random: () => 0,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    });

    await expect(client.set('selectors:save.button', '#save')).rejects.toMatchObject({
      name: 'RedisOperationError',
      operationName: 'set',
      attempts: 3,
    } as Partial<RedisOperationError>);

    expect(fakeDriver.set).toHaveBeenCalledTimes(3);
    const setSpan = telemetry.spans.find(
      (span) => span.attributes['auroraflow.redis.operation'] === 'set',
    );
    expect(setSpan?.status?.code).toBe('error');
    expect(setSpan?.attributes).toMatchObject({
      'auroraflow.redis.operation.status': 'failed',
      'auroraflow.redis.operation.attempts': 3,
      'auroraflow.redis.operation.retries': 2,
      'error.type': 'RedisOperationError',
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.redisOperationsTotal,
      value: 1,
      attributes: {
        'auroraflow.redis.operation': 'set',
        'auroraflow.redis.operation.status': 'failed',
      },
    });
    expect(telemetry.counters).toContainEqual({
      name: METRIC_NAMES.redisOperationRetriesTotal,
      value: 2,
      attributes: {
        'auroraflow.redis.operation': 'set',
        'auroraflow.redis.operation.status': 'failed',
      },
    });
  });

  it('supports key prefix stripping on keys() results from cursor scans', async () => {
    fakeDriver.scanIterator.mockReturnValue(
      (async function* scanKeys(): AsyncGenerator<string | string[], void, void> {
        yield ['aurora:selector-registry:two', 'aurora:selector-registry:one'];
      })(),
    );

    const client = new RedisClient({
      config: {
        host: '127.0.0.1',
        port: 6379,
        database: 0,
        tls: false,
        connectTimeoutMs: 1000,
        maxRetries: 0,
        baseBackoffMs: 5,
        maxBackoffMs: 10,
        keyPrefix: 'aurora',
      },
      createClient: () => fakeDriver,
      sleep: async () => {},
      random: () => 0,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    });

    const keys = await client.keys('selector-registry:*');

    expect(fakeDriver.scanIterator).toHaveBeenCalledWith({
      MATCH: 'aurora:selector-registry:*',
    });
    expect(keys).toEqual(['selector-registry:one', 'selector-registry:two']);
  });

  it('supports batched mget with namespaced keys', async () => {
    fakeDriver.mGet.mockResolvedValue(['one', null, 'three']);

    const client = new RedisClient({
      config: {
        host: '127.0.0.1',
        port: 6379,
        database: 0,
        tls: false,
        connectTimeoutMs: 1000,
        maxRetries: 0,
        baseBackoffMs: 5,
        maxBackoffMs: 10,
        keyPrefix: 'aurora',
      },
      createClient: () => fakeDriver,
      sleep: async () => {},
      random: () => 0,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    });

    const values = await client.mget([
      'selector-registry:one',
      'selector-registry:two',
      'selector-registry:three',
    ]);

    expect(fakeDriver.mGet).toHaveBeenCalledWith([
      'aurora:selector-registry:one',
      'aurora:selector-registry:two',
      'aurora:selector-registry:three',
    ]);
    expect(values).toEqual(['one', null, 'three']);
  });

  it('passes bounded count hints to scanIterator', async () => {
    fakeDriver.scanIterator.mockReturnValue(
      (async function* scanKeys(): AsyncGenerator<string, void, void> {
        yield 'aurora:selector-registry:one';
      })(),
    );

    const client = new RedisClient({
      config: {
        host: '127.0.0.1',
        port: 6379,
        database: 0,
        tls: false,
        connectTimeoutMs: 1000,
        maxRetries: 0,
        baseBackoffMs: 5,
        maxBackoffMs: 10,
        keyPrefix: 'aurora',
      },
      createClient: () => fakeDriver,
      sleep: async () => {},
      random: () => 0,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    });

    const keys = await client.keys('selector-registry:*', { count: 250 });

    expect(fakeDriver.scanIterator).toHaveBeenCalledWith({
      MATCH: 'aurora:selector-registry:*',
      COUNT: 250,
    });
    expect(keys).toEqual(['selector-registry:one']);
  });

  it('disconnects cleanly when the client is open', async () => {
    const client = new RedisClient({
      config: {
        host: '127.0.0.1',
        port: 6379,
        database: 0,
        tls: false,
        connectTimeoutMs: 1000,
        maxRetries: 0,
        baseBackoffMs: 5,
        maxBackoffMs: 10,
        keyPrefix: 'aurora',
      },
      createClient: () => fakeDriver,
      sleep: async () => {},
      random: () => 0,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    });

    await client.connect();
    await client.disconnect();

    expect(fakeDriver.quit).toHaveBeenCalledTimes(1);
  });
});
