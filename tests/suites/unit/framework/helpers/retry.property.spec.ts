import { describe, expect, it, vi } from 'vitest';
import { retry } from '../../../../../src/helpers/helpers';
import { createSeededRandom, randomFrom, randomInt } from '../../../../helpers/propertyTesting';

/**
 * AUR-QE-110 scoped property baseline for the retry helper.
 *
 * Control-flow invariants must hold regardless of jitter/randomness: the function
 * is invoked exactly as many times as needed and never more than `retries`, and
 * invalid bounded options are rejected before the work runs.
 */

describe('retry control-flow properties', () => {
  it('invokes fn the minimal number of times and honors the retry budget', async () => {
    const seed = 0xfee1;
    const random = createSeededRandom(seed);

    for (let run = 0; run < 150; run += 1) {
      const retries = randomInt(random, 1, 8);
      const successAttempt = randomInt(random, 1, 10);
      const jitterRatio = randomFrom(random, [0, 0.25, 1]);
      const randomValue = randomFrom(random, [0, 0.5, 0.999]);
      let calls = 0;

      const fn = vi.fn(async () => {
        calls += 1;
        if (calls < successAttempt) {
          throw new Error(`transient ${calls}`);
        }
        return 'ok';
      });

      const context = `seed=${seed}, run=${run}, retries=${retries}, successAttempt=${successAttempt}`;
      const promise = retry({
        fn,
        retries,
        initialDelay: 0,
        backoffFactor: 2,
        maxDelay: 100,
        jitterRatio,
        random: () => randomValue,
        logger: null,
      });

      if (successAttempt <= retries) {
        await expect(promise, context).resolves.toBe('ok');
        expect(calls, context).toBe(successAttempt);
      } else {
        await expect(promise, context).rejects.toThrow(`All ${retries} retries failed`);
        expect(calls, context).toBe(retries);
      }
      expect(calls, context).toBeLessThanOrEqual(retries);
    }
  });

  it('rejects out-of-range bounded options before invoking fn', async () => {
    const seed = 0xfee2;
    const random = createSeededRandom(seed);

    for (let run = 0; run < 80; run += 1) {
      const fn = vi.fn(async () => 'never');
      const invalid = randomFrom(random, [
        { retries: 0 },
        { retries: 21 },
        { backoffFactor: 0.5 },
        { backoffFactor: 11 },
        { jitterRatio: -0.1 },
        { jitterRatio: 1.5 },
        { initialDelay: -1 },
        { maxDelay: 60_001 },
      ]);

      const context = `seed=${seed}, run=${run}, invalid=${JSON.stringify(invalid)}`;
      await expect(retry({ fn, logger: null, ...invalid }), context).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(fn, context).not.toHaveBeenCalled();
    }
  });
});
