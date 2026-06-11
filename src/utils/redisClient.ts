import { performance } from 'node:perf_hooks';
import { createClient, type RedisClientOptions } from 'redis';
import {
  SPAN_NAMES,
  buildRedisOperationMetricAttributes,
  buildRedisOperationSpanAttributes,
  type RedisOperationStatus,
} from '../framework/observability/attributes';
import { METRIC_NAMES } from '../framework/observability/metricNames';
import { getTelemetry } from '../framework/observability/telemetry';
import { createChildLogger, type Logger } from './logger';

const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REDIS_MAX_RETRIES = 3;
const DEFAULT_REDIS_BASE_BACKOFF_MS = 50;
const DEFAULT_REDIS_MAX_BACKOFF_MS = 2_000;
const DEFAULT_REDIS_KEY_PREFIX = 'auroraflow';
const REDIS_COMPARE_AND_SET_EXPECT_ABSENT = '__AURORAFLOW_EXPECT_ABSENT__';
const REDIS_COMPARE_AND_SET_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local expected = ARGV[1]
local nextValue = ARGV[2]
local ttlSeconds = ARGV[3]

if expected == "${REDIS_COMPARE_AND_SET_EXPECT_ABSENT}" then
  if current then
    return {"0", current}
  end
else
  if not current then
    return {"0", ""}
  end
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or type(decoded) ~= "table" or tonumber(decoded["version"]) ~= tonumber(expected) then
    return {"0", current}
  end
end

if ttlSeconds == "" then
  redis.call("SET", KEYS[1], nextValue)
else
  redis.call("SET", KEYS[1], nextValue, "EX", tonumber(ttlSeconds))
end

return {"1", current or ""}
`;
const REDIS_ATOMIC_JSON_MERGE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local defaults = cjson.decode(ARGV[1])
local increments = cjson.decode(ARGV[2])
local sets = cjson.decode(ARGV[3])
local ttlSeconds = ARGV[4]
local record = defaults

if current then
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or type(decoded) ~= "table" then
    return redis.error_reply("AuroraFlow atomic JSON merge target must contain a JSON object")
  end
  record = decoded
  for fieldName, value in pairs(defaults) do
    if record[fieldName] == nil then
      record[fieldName] = value
    end
  end
end

for fieldName, increment in pairs(increments) do
  local rawCurrentValue = record[fieldName]
  if rawCurrentValue ~= nil and tonumber(rawCurrentValue) == nil then
    return redis.error_reply("AuroraFlow atomic JSON merge counter field must be numeric")
  end
  local currentValue = tonumber(rawCurrentValue) or 0
  record[fieldName] = currentValue + tonumber(increment)
end

for fieldName, value in pairs(sets) do
  record[fieldName] = value
end

local nextValue = cjson.encode(record)
if ttlSeconds == "" then
  redis.call("SET", KEYS[1], nextValue)
else
  redis.call("SET", KEYS[1], nextValue, "EX", tonumber(ttlSeconds))
end

return nextValue
`;

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

export type RedisJsonPrimitive = string | number | boolean | null;
export type RedisJsonObject = Readonly<Record<string, RedisJsonPrimitive>>;

export interface RedisAtomicJsonMergePatch {
  defaultValue: RedisJsonObject;
  increments?: Readonly<Record<string, number>>;
  set?: RedisJsonObject;
}

export interface RedisAtomicJsonMergeOptions extends RedisSetOptions {
  patch: RedisAtomicJsonMergePatch;
}

export interface RedisCompareAndSetOptions extends RedisSetOptions {
  expectedVersion: number | null;
}

export interface RedisCompareAndSetResult {
  written: boolean;
  existingValue: string | null;
}

export interface RedisScanOptions {
  count?: number;
}

interface RedisSetCommandOptions {
  EX: number;
}

interface RedisScanCommandOptions {
  MATCH: string;
  COUNT?: number;
}

interface RedisEvalOptions {
  keys?: string[];
  arguments?: string[];
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
  mGet(keys: string[]): Promise<Array<string | null>>;
  scanIterator(options: RedisScanCommandOptions): AsyncIterable<string | string[]>;
  eval?(script: string, options?: RedisEvalOptions): Promise<unknown>;
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

  public async mget(keys: readonly string[]): Promise<Array<string | null>> {
    const qualifiedKeys = keys.map((key) => this.qualifyKey(key));
    if (qualifiedKeys.length === 0) {
      return [];
    }
    return this.executeCommand('mget', (client) => client.mGet(qualifiedKeys));
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

  public async compareAndSetJsonVersion(
    key: string,
    value: string,
    options: RedisCompareAndSetOptions,
  ): Promise<RedisCompareAndSetResult> {
    const qualifiedKey = this.qualifyKey(key);
    const expectedVersion = this.normalizeCompareAndSetExpectedVersion(options.expectedVersion);
    const ttlSeconds =
      options.ttlSeconds === undefined ? '' : String(this.normalizeTtlSeconds(options.ttlSeconds));

    const reply = await this.executeCommand('compareAndSetJsonVersion', async (client) => {
      if (!client.eval) {
        throw new RedisConfigError(
          'Redis client driver must support EVAL for compare-and-set operations.',
        );
      }
      return client.eval(REDIS_COMPARE_AND_SET_SCRIPT, {
        keys: [qualifiedKey],
        arguments: [expectedVersion, value, ttlSeconds],
      });
    });

    return this.parseCompareAndSetReply(reply);
  }

  public async atomicJsonMerge(key: string, options: RedisAtomicJsonMergeOptions): Promise<string> {
    const qualifiedKey = this.qualifyKey(key);
    const ttlSeconds =
      options.ttlSeconds === undefined ? '' : String(this.normalizeTtlSeconds(options.ttlSeconds));
    const defaultValue = this.serializeJsonObject(options.patch.defaultValue, 'defaultValue');
    const increments = this.serializeJsonIncrements(options.patch.increments ?? {});
    const set = this.serializeJsonObject(options.patch.set ?? {}, 'set');

    const reply = await this.executeCommand('atomicJsonMerge', async (client) => {
      if (!client.eval) {
        throw new RedisConfigError(
          'Redis client driver must support EVAL for atomic JSON merge operations.',
        );
      }
      return client.eval(REDIS_ATOMIC_JSON_MERGE_SCRIPT, {
        keys: [qualifiedKey],
        arguments: [defaultValue, increments, set, ttlSeconds],
      });
    });

    return this.parseAtomicJsonMergeReply(reply);
  }

  public async del(key: string): Promise<number> {
    const qualifiedKey = this.qualifyKey(key);
    return this.executeCommand('del', (client) => client.del(qualifiedKey));
  }

  public async *scanKeys(
    pattern: string,
    options: RedisScanOptions = {},
  ): AsyncGenerator<string, void, void> {
    this.assertValidPattern(pattern);
    const qualifiedPattern = this.qualifyPattern(pattern);
    const count = this.normalizeScanCount(options.count);
    const iterator = await this.executeCommand('scanIterator', async (client) =>
      client.scanIterator({
        MATCH: qualifiedPattern,
        ...(count === undefined ? {} : { COUNT: count }),
      }),
    );

    for await (const entry of iterator) {
      const matchedKeys = Array.isArray(entry) ? entry : [entry];
      for (const key of matchedKeys) {
        yield this.stripPrefix(key);
      }
    }
  }

  public async keys(pattern: string, options: RedisScanOptions = {}): Promise<string[]> {
    const matchedKeys: string[] = [];
    for await (const key of this.scanKeys(pattern, options)) {
      matchedKeys.push(key);
    }
    return matchedKeys.sort((left, right) => left.localeCompare(right));
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
    const telemetry = getTelemetry();
    const startedAt = performance.now();
    let attempt = 0;
    let status: RedisOperationStatus = 'failed';
    let operationError: Error | undefined;

    return telemetry.runSpan({
      name: SPAN_NAMES.redisOperation,
      attributes: buildRedisOperationSpanAttributes({ operationName }),
      task: async (span) => {
        try {
          while (true) {
            attempt += 1;
            try {
              const value = await operation();
              status = 'succeeded';
              return value;
            } catch (error: unknown) {
              if (attempt > this.config.maxRetries) {
                operationError = new RedisOperationError(
                  `Redis ${operationName} failed after ${attempt} attempt(s).`,
                  operationName,
                  attempt,
                  error,
                );
                throw operationError;
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
        } finally {
          const durationMs = performance.now() - startedAt;
          const retryCount = Math.max(0, attempt - 1);
          const metricAttributes = buildRedisOperationMetricAttributes({
            operationName,
            status,
          });
          span.setAttribute('auroraflow.redis.operation.status', status);
          span.setAttribute('auroraflow.redis.operation.attempts', attempt);
          span.setAttribute('auroraflow.redis.operation.retries', retryCount);
          span.setAttribute('auroraflow.redis.operation.duration_ms', durationMs);
          if (operationError !== undefined) {
            span.setAttribute('error.type', operationError.name);
          }
          telemetry.recordCounter(METRIC_NAMES.redisOperationsTotal, 1, metricAttributes);
          telemetry.recordHistogram(
            METRIC_NAMES.redisOperationDurationMs,
            durationMs,
            metricAttributes,
          );
          if (retryCount > 0) {
            telemetry.recordCounter(
              METRIC_NAMES.redisOperationRetriesTotal,
              retryCount,
              metricAttributes,
            );
          }
        }
      },
    });
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

  private normalizeCompareAndSetExpectedVersion(expectedVersion: number | null): string {
    if (expectedVersion === null) {
      return REDIS_COMPARE_AND_SET_EXPECT_ABSENT;
    }

    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new RedisConfigError('expectedVersion must be a positive integer or null.');
    }

    return String(expectedVersion);
  }

  private parseCompareAndSetReply(reply: unknown): RedisCompareAndSetResult {
    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new RedisConfigError('Unexpected Redis compare-and-set reply shape.');
    }

    const [writtenReply, existingReply] = reply;
    const written = writtenReply === 1 || writtenReply === '1';
    if (!written && writtenReply !== 0 && writtenReply !== '0') {
      throw new RedisConfigError('Unexpected Redis compare-and-set status reply.');
    }

    if (existingReply === null || existingReply === '') {
      return { written, existingValue: null };
    }

    if (typeof existingReply === 'string') {
      return { written, existingValue: existingReply };
    }

    if (Buffer.isBuffer(existingReply)) {
      const existingValue = existingReply.toString('utf8');
      return { written, existingValue: existingValue.length > 0 ? existingValue : null };
    }

    throw new RedisConfigError('Unexpected Redis compare-and-set existing-value reply.');
  }

  private parseAtomicJsonMergeReply(reply: unknown): string {
    if (typeof reply === 'string') {
      return reply;
    }

    if (Buffer.isBuffer(reply)) {
      return reply.toString('utf8');
    }

    throw new RedisConfigError('Unexpected Redis atomic JSON merge reply shape.');
  }

  private serializeJsonObject(value: RedisJsonObject, label: string): string {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new RedisConfigError(`atomicJsonMerge ${label} must be a JSON object.`);
    }

    for (const [fieldName, fieldValue] of Object.entries(value)) {
      this.validateJsonFieldName(fieldName, label);
      if (
        fieldValue === null ||
        typeof fieldValue === 'string' ||
        typeof fieldValue === 'boolean'
      ) {
        continue;
      }
      if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) {
        continue;
      }
      throw new RedisConfigError(`atomicJsonMerge ${label}.${fieldName} must be a JSON primitive.`);
    }

    return JSON.stringify(value);
  }

  private serializeJsonIncrements(increments: Readonly<Record<string, number>>): string {
    for (const [fieldName, increment] of Object.entries(increments)) {
      this.validateJsonFieldName(fieldName, 'increments');
      if (!Number.isInteger(increment)) {
        throw new RedisConfigError(`atomicJsonMerge increments.${fieldName} must be an integer.`);
      }
    }

    return JSON.stringify(increments);
  }

  private validateJsonFieldName(fieldName: string, label: string): void {
    if (!/^[A-Za-z0-9_.:-]+$/.test(fieldName)) {
      throw new RedisConfigError(`atomicJsonMerge ${label} contains unsupported field name.`);
    }
  }

  private normalizeTtlSeconds(ttlSeconds: number): number {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 2_592_000) {
      throw new RedisConfigError('ttlSeconds must be an integer between 1 and 2592000.');
    }
    return ttlSeconds;
  }

  private normalizeScanCount(count: number | undefined): number | undefined {
    if (count === undefined) {
      return undefined;
    }
    if (!Number.isInteger(count) || count <= 0 || count > 10_000) {
      throw new RedisConfigError('scan count must be an integer between 1 and 10000.');
    }
    return count;
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
