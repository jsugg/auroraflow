import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../../src/framework/observability/telemetry';
import {
  RedisClient,
  RedisConfigError,
  type RedisClientDriver,
} from '../../../../../src/utils/redisClient';
import { CapturingTelemetry } from '../observability/capturingTelemetry';
import { createSeededRandom, randomFrom } from '../../../../helpers/propertyTesting';

/**
 * AUR-QE-110 scoped property baseline for the Redis compare-and-set adapter.
 *
 * The Lua reply parser and expected-version normalization are CAS-critical: a
 * misparse silently corrupts optimistic concurrency. These seeded properties pin
 * the reply-shape mapping and the expected-version contract.
 */

// Mirrors the private sentinel in redisClient.ts for the "expect key absent" case.
const EXPECT_ABSENT = '__AURORAFLOW_EXPECT_ABSENT__';

class CasDriver {
  public isOpen = false;
  public readonly eval = vi.fn(
    async (script: string, options: { keys: string[]; arguments: string[] }) => {
      void script;
      void options;
      return [1, null] as unknown;
    },
  );

  public async connect(): Promise<void> {
    this.isOpen = true;
  }

  public on(): void {}
}

function buildClient(driver: CasDriver): RedisClient {
  return new RedisClient({
    config: {
      host: '127.0.0.1',
      port: 6379,
      database: 0,
      tls: false,
      connectTimeoutMs: 1000,
      maxRetries: 1,
      baseBackoffMs: 1,
      maxBackoffMs: 5,
      keyPrefix: 'aurora',
    },
    createClient: () => driver as unknown as RedisClientDriver,
    sleep: async () => {},
    random: () => 0,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
  });
}

describe('Redis compare-and-set reply parsing properties', () => {
  beforeEach(() => {
    setTelemetryForTests(new CapturingTelemetry());
  });

  afterEach(() => {
    resetTelemetryForTests();
  });

  it('maps every supported reply shape to the correct CAS result', async () => {
    const seed = 0xca5;
    const random = createSeededRandom(seed);
    const writtenTokens = [1, '1', 0, '0'] as const;
    const existingValues = [null, '', '{"version":2}', Buffer.from('payload'), Buffer.from('')];

    for (let run = 0; run < 120; run += 1) {
      const writtenToken = randomFrom(random, writtenTokens);
      const existing = randomFrom(random, existingValues);
      const driver = new CasDriver();
      driver.eval.mockResolvedValue([writtenToken, existing]);
      const client = buildClient(driver);

      const result = await client.compareAndSetJsonVersion('selectors:login', 'payload', {
        expectedVersion: null,
      });

      const expectedWritten = writtenToken === 1 || writtenToken === '1';
      let expectedExisting: string | null;
      if (existing === null || existing === '') {
        expectedExisting = null;
      } else if (typeof existing === 'string') {
        expectedExisting = existing;
      } else {
        const decoded = existing.toString('utf8');
        expectedExisting = decoded.length > 0 ? decoded : null;
      }

      const context = `seed=${seed}, run=${run}, written=${String(writtenToken)}`;
      expect(result.written, context).toBe(expectedWritten);
      expect(result.existingValue, context).toBe(expectedExisting);
    }
  });

  it('rejects malformed reply shapes', async () => {
    const malformed = [null, 'oops', [1], [1, 'extra', 3], [2, null], ['maybe', null]];
    for (const reply of malformed) {
      const driver = new CasDriver();
      driver.eval.mockResolvedValue(reply);
      const client = buildClient(driver);

      await expect(
        client.compareAndSetJsonVersion('selectors:login', 'payload', { expectedVersion: null }),
      ).rejects.toBeInstanceOf(RedisConfigError);
    }
  });
});

describe('Redis expected-version normalization properties', () => {
  beforeEach(() => {
    setTelemetryForTests(new CapturingTelemetry());
  });

  afterEach(() => {
    resetTelemetryForTests();
  });

  it('passes the absent sentinel for null and the integer string for positive versions', async () => {
    const seed = 0xca6;
    const random = createSeededRandom(seed);

    for (let run = 0; run < 120; run += 1) {
      const expectedVersion = randomFrom(random, [null, 1, 2, 7, 42, 1000]);
      const driver = new CasDriver();
      driver.eval.mockResolvedValue([1, null]);
      const client = buildClient(driver);

      await client.compareAndSetJsonVersion('selectors:login', 'payload', { expectedVersion });

      const lastCall = driver.eval.mock.calls.at(-1);
      const sentArguments = lastCall?.[1].arguments ?? [];
      const context = `seed=${seed}, run=${run}, expectedVersion=${String(expectedVersion)}`;
      if (expectedVersion === null) {
        expect(sentArguments[0], context).toBe(EXPECT_ABSENT);
      } else {
        expect(sentArguments[0], context).toBe(String(expectedVersion));
      }
    }
  });

  it('rejects non-positive or non-integer expected versions before issuing EVAL', async () => {
    for (const expectedVersion of [0, -1, -5, 1.5, 2.9]) {
      const driver = new CasDriver();
      const client = buildClient(driver);

      await expect(
        client.compareAndSetJsonVersion('selectors:login', 'payload', { expectedVersion }),
      ).rejects.toBeInstanceOf(RedisConfigError);
      expect(driver.eval).not.toHaveBeenCalled();
    }
  });
});
