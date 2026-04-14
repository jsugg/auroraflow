import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RedisClient,
  RedisConfigError,
  RedisOperationError,
  resolveRedisRuntimeConfig,
  type RedisClientDriver,
} from '../../../../../src/utils/redisClient';

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
  public readonly keys = vi.fn(async (pattern: string) => {
    void pattern;
    return [] as string[];
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

  it('retries transient failures and eventually succeeds', async () => {
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
  });

  it('throws RedisOperationError after retry exhaustion', async () => {
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
  });

  it('supports key prefix stripping on keys() results', async () => {
    fakeDriver.keys.mockResolvedValue([
      'aurora:selector-registry:one',
      'aurora:selector-registry:two',
    ]);

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

    expect(fakeDriver.keys).toHaveBeenCalledWith('aurora:selector-registry:*');
    expect(keys).toEqual(['selector-registry:one', 'selector-registry:two']);
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
