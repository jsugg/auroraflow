import { afterEach, describe, expect, it, vi } from 'vitest';
import { retry, wait } from '../../../../../src/helpers/helpers';
import type { Logger } from '../../../../../src/utils/logger';

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('retry helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the eventual success value within retry budget', async () => {
    let attempts = 0;

    const result = await retry({
      fn: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(`transient-${attempts}`);
        }
        return 'ok';
      },
      retries: 3,
      initialDelay: 1,
      backoffFactor: 2,
      logger: null,
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws with the last error message after retries are exhausted', async () => {
    let attempts = 0;

    await expect(
      retry({
        fn: async () => {
          attempts += 1;
          throw new Error('boom');
        },
        retries: 2,
        initialDelay: 1,
        backoffFactor: 2,
        logger: null,
      }),
    ).rejects.toThrow('All 2 retries failed. Last error: boom');

    expect(attempts).toBe(2);
  });

  it('throws a generic exhaustion error when non-Error values are thrown', async () => {
    let attempts = 0;

    await expect(
      retry({
        fn: async () => {
          attempts += 1;
          throw 'boom';
        },
        retries: 2,
        initialDelay: 1,
        backoffFactor: 2,
        logger: null,
      }),
    ).rejects.toThrow('All 2 retries failed.');

    expect(attempts).toBe(2);
  });

  it('applies exponential backoff delays between attempts', async () => {
    let attempts = 0;
    const recordedDelays: number[] = [];
    const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...args: unknown[]
    ) => {
      recordedDelays.push(Number(timeout ?? 0));
      return nativeSetTimeout(handler, 0, ...args);
    }) as typeof setTimeout);

    await retry({
      fn: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('retry me');
        }
        return undefined;
      },
      retries: 3,
      initialDelay: 10,
      backoffFactor: 2,
      logger: null,
    });

    expect(recordedDelays).toEqual([10, 20]);
  });

  it('applies deterministic bounded jitter and caps max delay', async () => {
    let attempts = 0;
    const recordedDelays: number[] = [];
    const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...args: unknown[]
    ) => {
      recordedDelays.push(Number(timeout ?? 0));
      return nativeSetTimeout(handler, 0, ...args);
    }) as typeof setTimeout);

    await retry({
      fn: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('retry me');
        }
        return undefined;
      },
      retries: 3,
      initialDelay: 10,
      backoffFactor: 2,
      maxDelay: 15,
      jitterRatio: 0.2,
      random: () => 1,
      logger: null,
    });

    expect(recordedDelays).toEqual([12, 15]);
  });

  it('rejects invalid retry and wait options before scheduling delays', async () => {
    const fn = vi.fn(async () => 'unused');

    await expect(retry({ fn, retries: 0, logger: null })).rejects.toThrow(
      'retries must be an integer between 1 and 20.',
    );
    await expect(retry({ fn, initialDelay: -1, logger: null })).rejects.toThrow(
      'initialDelay must be an integer between 0 and 60000.',
    );
    await expect(retry({ fn, backoffFactor: 0.5, logger: null })).rejects.toThrow(
      'backoffFactor must be a finite number between 1 and 10.',
    );
    await expect(retry({ fn, maxDelay: 60_001, logger: null })).rejects.toThrow(
      'maxDelay must be an integer between 0 and 60000.',
    );
    await expect(retry({ fn, jitterRatio: 1.1, logger: null })).rejects.toThrow(
      'jitterRatio must be a finite number between 0 and 1.',
    );
    expect(() => wait(Number.NaN, null)).toThrow('ms must be an integer between 0 and 60000.');

    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects random sources that return out-of-range jitter values', async () => {
    let attempts = 0;

    await expect(
      retry({
        fn: async () => {
          attempts += 1;
          throw new Error('retry me');
        },
        retries: 2,
        initialDelay: 10,
        jitterRatio: 0.1,
        random: () => 2,
        logger: null,
      }),
    ).rejects.toThrow('random must return a finite number between 0 and 1.');

    expect(attempts).toBe(1);
  });

  it('uses the provided logger for both retry and wait logging paths', async () => {
    let attempts = 0;
    const logger = createLoggerMock();

    await retry({
      fn: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('first failure');
        }
        return 'done';
      },
      retries: 2,
      initialDelay: 1,
      backoffFactor: 2,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith('Attempt 1 failed: first failure. Retrying in 1ms...');
    expect(logger.info).toHaveBeenCalledWith('Waiting for 1ms');
  });
});
