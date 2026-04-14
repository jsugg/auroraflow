import { createClient, type RedisClientOptions } from 'redis';
import { createChildLogger, type Logger } from './logger';

const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REDIS_MAX_RETRIES = 3;
const DEFAULT_REDIS_BASE_BACKOFF_MS = 50;
const DEFAULT_REDIS_MAX_BACKOFF_MS = 2_000;
const DEFAULT_REDIS_KEY_PREFIX = 'auroraflow';

export class RedisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisConfigError';
  }
}

export class RedisConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RedisConnectionError';
  }
}

export class RedisOperationError extends Error {
  constructor(
    message: string,
    public readonly operationName: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RedisOperationError';
  }
}

export interface RedisRuntimeConfig {
  url?: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  database: number;
  tls: boolean;
  connectTimeoutMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  keyPrefix: string;
}

export interface RedisSetOptions {
  ttlSeconds?: number;
}

interface RedisSetCommandOptions {
  EX: number;
}

export interface RedisClientDriver {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<void>;
  quit(): Promise<string>;
  disconnect(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): void;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetCommandOptions): Promise<string | null>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

type RedisClientFactory = (options: RedisClientOptions) => RedisClientDriver;
type SleepFunction = (ms: number) => Promise<void>;
type RandomFunction = () => number;

function parseIntegerEnv({
  key,
  value,
  defaultValue,
  minimum,
  maximum,
}: {
  key: string;
  value: string | undefined;
  defaultValue: number;
  minimum: number;
  maximum: number;
}): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RedisConfigError(
      `${key} must be an integer between ${minimum} and ${maximum}. Received: ${value}`,
    );
  }

  return parsed;
}

function parseBooleanEnv({
  key,
  value,
  defaultValue,
}: {
  key: string;
  value: string | undefined;
  defaultValue: boolean;
}): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }

  throw new RedisConfigError(`${key} must be a boolean-like value. Received: ${value}`);
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizeKeyPrefix(rawPrefix: string | undefined): string {
  const normalizedPrefix = normalizeOptional(rawPrefix) ?? DEFAULT_REDIS_KEY_PREFIX;
  if (normalizedPrefix.length > 64) {
    throw new RedisConfigError('AURORAFLOW_REDIS_KEY_PREFIX must be 64 characters or less.');
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(normalizedPrefix)) {
    throw new RedisConfigError(
      'AURORAFLOW_REDIS_KEY_PREFIX may only include letters, numbers, :, _, and -.',
    );
  }

  return normalizedPrefix.replace(/:+$/g, '');
}

function parseRedisUrl(url: string | undefined): string | undefined {
  const normalized = normalizeOptional(url);
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      throw new RedisConfigError(
        'AURORAFLOW_REDIS_URL must use the redis:// or rediss:// protocol.',
      );
    }
  } catch (error: unknown) {
    if (error instanceof RedisConfigError) {
      throw error;
    }
    throw new RedisConfigError('AURORAFLOW_REDIS_URL is not a valid URL.');
  }

  return normalized;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRedisClientFactory(): RedisClientFactory {
  return (options: RedisClientOptions): RedisClientDriver =>
    createClient(options) as unknown as RedisClientDriver;
}

export function resolveRedisRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RedisRuntimeConfig {
  const url = parseRedisUrl(env.AURORAFLOW_REDIS_URL);
  const config: RedisRuntimeConfig = {
    url,
    host: normalizeOptional(env.AURORAFLOW_REDIS_HOST) ?? DEFAULT_REDIS_HOST,
    port: parseIntegerEnv({
      key: 'AURORAFLOW_REDIS_PORT',
      value: env.AURORAFLOW_REDIS_PORT,
      defaultValue: DEFAULT_REDIS_PORT,
      minimum: 1,
      maximum: 65_535,
    }),
    username: normalizeOptional(env.AURORAFLOW_REDIS_USERNAME),
    password: normalizeOptional(env.AURORAFLOW_REDIS_PASSWORD),
    database: parseIntegerEnv({
      key: 'AURORAFLOW_REDIS_DB',
      value: env.AURORAFLOW_REDIS_DB,
      defaultValue: DEFAULT_REDIS_DB,
      minimum: 0,
      maximum: 16,
    }),
    tls: parseBooleanEnv({
      key: 'AURORAFLOW_REDIS_TLS',
      value: env.AURORAFLOW_REDIS_TLS,
      defaultValue: false,
    }),
    connectTimeoutMs: parseIntegerEnv({
      key: 'AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS',
      value: env.AURORAFLOW_REDIS_CONNECT_TIMEOUT_MS,
      defaultValue: DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
      minimum: 100,
      maximum: 120_000,
    }),
    maxRetries: parseIntegerEnv({
      key: 'AURORAFLOW_REDIS_MAX_RETRIES',
      value: env.AURORAFLOW_REDIS_MAX_RETRIES,
      defaultValue: DEFAULT_REDIS_MAX_RETRIES,
      minimum: 0,
      maximum: 20,
    }),
    baseBackoffMs: parseIntegerEnv({
      key: 'AURORAFLOW_REDIS_BASE_BACKOFF_MS',
      value: env.AURORAFLOW_REDIS_BASE_BACKOFF_MS,
      defaultValue: DEFAULT_REDIS_BASE_BACKOFF_MS,
      minimum: 1,
      maximum: 10_000,
    }),
    maxBackoffMs: parseIntegerEnv({
      key: 'AURORAFLOW_REDIS_MAX_BACKOFF_MS',
      value: env.AURORAFLOW_REDIS_MAX_BACKOFF_MS,
      defaultValue: DEFAULT_REDIS_MAX_BACKOFF_MS,
      minimum: 1,
      maximum: 120_000,
    }),
    keyPrefix: normalizeKeyPrefix(env.AURORAFLOW_REDIS_KEY_PREFIX),
  };

  if (config.maxBackoffMs < config.baseBackoffMs) {
    throw new RedisConfigError(
      'AURORAFLOW_REDIS_MAX_BACKOFF_MS must be greater than or equal to AURORAFLOW_REDIS_BASE_BACKOFF_MS.',
    );
  }

  return config;
}

/** Redis client wrapper with deterministic retry and key namespacing behavior. */
export class RedisClient {
  private readonly config: RedisRuntimeConfig;
  private readonly createClient: RedisClientFactory;
  private readonly sleep: SleepFunction;
  private readonly random: RandomFunction;
  private readonly logger: Logger;
  private client: RedisClientDriver | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor({
    config,
    env = process.env,
    createClient = toRedisClientFactory(),
    sleep = defaultSleep,
    random = Math.random,
    logger = createChildLogger('RedisClient'),
  }: {
    config?: RedisRuntimeConfig;
    env?: Readonly<Record<string, string | undefined>>;
    createClient?: RedisClientFactory;
    sleep?: SleepFunction;
    random?: RandomFunction;
    logger?: Logger;
  } = {}) {
    this.config = config ?? resolveRedisRuntimeConfig(env);
    this.createClient = createClient;
    this.sleep = sleep;
    this.random = random;
    this.logger = logger;
  }

  public async connect(): Promise<void> {
    if (this.client?.isOpen) {
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.client = this.createClient(this.buildClientOptions());
    this.client.on('error', (error) => {
      this.logger.error('Redis client emitted an error event.', { error });
    });

    this.connectPromise = this.executeWithRetry('connect', async () => {
      await this.client?.connect();
    }).catch((error: unknown) => {
      this.client = null;
      if (error instanceof RedisOperationError) {
        throw new RedisConnectionError(error.message, error.cause);
      }
      throw new RedisConnectionError('Failed to connect Redis client.', error);
    });

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    const currentClient = this.client;
    this.client = null;

    if (!currentClient.isOpen) {
      return;
    }

    try {
      await currentClient.quit();
    } catch {
      await currentClient.disconnect();
    }
  }

  public async ping(): Promise<string> {
    return this.executeCommand('ping', (client) => client.ping());
  }

  public async get(key: string): Promise<string | null> {
    const qualifiedKey = this.qualifyKey(key);
    return this.executeCommand('get', (client) => client.get(qualifiedKey));
  }

  public async set(key: string, value: string, options: RedisSetOptions = {}): Promise<void> {
    const qualifiedKey = this.qualifyKey(key);
    const setOptions: RedisSetCommandOptions | undefined =
      options.ttlSeconds === undefined
        ? undefined
        : { EX: this.normalizeTtlSeconds(options.ttlSeconds) };

    await this.executeCommand('set', async (client) => {
      await client.set(qualifiedKey, value, setOptions);
    });
  }

  public async del(key: string): Promise<number> {
    const qualifiedKey = this.qualifyKey(key);
    return this.executeCommand('del', (client) => client.del(qualifiedKey));
  }

  public async keys(pattern: string): Promise<string[]> {
    this.assertValidPattern(pattern);
    const qualifiedPattern = this.qualifyPattern(pattern);
    const matchedKeys = await this.executeCommand('keys', (client) =>
      client.keys(qualifiedPattern),
    );
    return matchedKeys.map((entry) => this.stripPrefix(entry));
  }

  private buildClientOptions(): RedisClientOptions {
    const reconnectStrategy = (retries: number): false | number => {
      if (retries >= this.config.maxRetries) {
        return false;
      }
      return this.computeBackoffDelay(retries + 1);
    };

    const baseSocketOptions = {
      connectTimeout: this.config.connectTimeoutMs,
      reconnectStrategy,
    };

    if (this.config.url) {
      return {
        url: this.config.url,
        socket: this.config.tls ? { ...baseSocketOptions, tls: true } : baseSocketOptions,
      };
    }

    return {
      socket: {
        ...baseSocketOptions,
        host: this.config.host,
        port: this.config.port,
        ...(this.config.tls ? { tls: true as const } : {}),
      },
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
    };
  }

  private async executeCommand<TValue>(
    operationName: string,
    operation: (client: RedisClientDriver) => Promise<TValue>,
  ): Promise<TValue> {
    if (!this.client?.isOpen) {
      await this.connect();
    }

    const resolvedClient = this.client;
    if (!resolvedClient) {
      throw new RedisConnectionError('Redis client is unavailable after connect attempt.');
    }

    return this.executeWithRetry(operationName, () => operation(resolvedClient));
  }

  private async executeWithRetry<TValue>(
    operationName: string,
    operation: () => Promise<TValue>,
  ): Promise<TValue> {
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        return await operation();
      } catch (error: unknown) {
        if (attempt > this.config.maxRetries) {
          throw new RedisOperationError(
            `Redis ${operationName} failed after ${attempt} attempt(s).`,
            operationName,
            attempt,
            error,
          );
        }

        const delayMs = this.computeBackoffDelay(attempt);
        this.logger.warn(
          `Redis ${operationName} attempt ${attempt} failed. Retrying in ${delayMs}ms.`,
          {
            error,
          },
        );
        await this.sleep(delayMs);
      }
    }
  }

  private computeBackoffDelay(attempt: number): number {
    const baseDelay = Math.min(
      this.config.baseBackoffMs * 2 ** Math.max(0, attempt - 1),
      this.config.maxBackoffMs,
    );
    const jitterRange = Math.max(1, Math.floor(this.config.baseBackoffMs / 2));
    const jitter = Math.floor(this.random() * jitterRange);
    return baseDelay + jitter;
  }

  private normalizeTtlSeconds(ttlSeconds: number): number {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 2_592_000) {
      throw new RedisConfigError('ttlSeconds must be an integer between 1 and 2592000.');
    }
    return ttlSeconds;
  }

  private qualifyKey(key: string): string {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new RedisConfigError('Redis key must not be empty.');
    }

    if (!/^[a-zA-Z0-9:*._-]+$/.test(normalizedKey)) {
      throw new RedisConfigError('Redis key contains unsupported characters.');
    }

    return `${this.config.keyPrefix}:${normalizedKey}`;
  }

  private qualifyPattern(pattern: string): string {
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern) {
      throw new RedisConfigError('Redis key pattern must not be empty.');
    }

    return `${this.config.keyPrefix}:${normalizedPattern}`;
  }

  private stripPrefix(key: string): string {
    const expectedPrefix = `${this.config.keyPrefix}:`;
    if (!key.startsWith(expectedPrefix)) {
      return key;
    }
    return key.slice(expectedPrefix.length);
  }

  private assertValidPattern(pattern: string): void {
    if (!/^[a-zA-Z0-9:*._-]+$/.test(pattern.trim())) {
      throw new RedisConfigError('Redis pattern contains unsupported characters.');
    }
  }
}

let sharedRedisClient: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!sharedRedisClient) {
    sharedRedisClient = new RedisClient();
  }
  return sharedRedisClient;
}

export async function resetRedisClientForTests(): Promise<void> {
  if (!sharedRedisClient) {
    return;
  }
  await sharedRedisClient.disconnect();
  sharedRedisClient = null;
}
