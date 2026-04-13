import { DataProvider } from './types';

type RedisStoredValue = string | null;

export interface RedisLikeClient {
  get(key: string): Promise<RedisStoredValue>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export interface RedisDataProviderOptions {
  client: RedisLikeClient;
  namespace?: string;
}

export class RedisDataProvider<TValue> implements DataProvider<TValue> {
  private readonly client: RedisLikeClient;
  private readonly namespace: string;

  constructor({ client, namespace = 'auroraflow' }: RedisDataProviderOptions) {
    this.client = client;
    this.namespace = namespace;
  }

  public async get(key: string): Promise<TValue | null> {
    const rawValue = await this.client.get(this.toRedisKey(key));
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue) as TValue;
    } catch {
      return null;
    }
  }

  public async set(key: string, value: TValue): Promise<void> {
    await this.client.set(this.toRedisKey(key), JSON.stringify(value));
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(this.toRedisKey(key));
  }

  public async keys(): Promise<string[]> {
    const prefix = `${this.namespace}:`;
    const resolvedKeys = await this.client.keys(`${prefix}*`);
    return resolvedKeys.map((recordKey) => recordKey.replace(prefix, '')).sort();
  }

  private toRedisKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
