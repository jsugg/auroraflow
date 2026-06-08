import { Logger, getMainLogger } from '../utils/logger';

const mainLogger: Logger = getMainLogger();
const MAX_WAIT_MS = 60_000;
const MAX_RETRIES = 20;
const MAX_BACKOFF_FACTOR = 10;

interface RetryOptions<T> {
  fn: () => Promise<T>;
  retries?: number;
  initialDelay?: number;
  backoffFactor?: number;
  maxDelay?: number;
  jitterRatio?: number;
  random?: () => number;
  logger?: Logger | null;
}

function validateIntegerOption(value: number, optionName: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${optionName} must be an integer between ${min} and ${max}.`);
  }
}

function validateFiniteOption(value: number, optionName: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${optionName} must be a finite number between ${min} and ${max}.`);
  }
}

function normalizeRandomValue(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('random must return a finite number between 0 and 1.');
  }
  return value;
}

function applyJitter(
  delayMs: number,
  jitterRatio: number,
  random: () => number,
  maxDelay: number,
): number {
  if (jitterRatio === 0 || delayMs === 0) {
    return delayMs;
  }

  const spread = delayMs * jitterRatio;
  const offset = (normalizeRandomValue(random) * 2 - 1) * spread;
  return Math.min(maxDelay, Math.max(0, Math.round(delayMs + offset)));
}

/**
 * Waits for a specified number of milliseconds.
 * This function can be used to delay execution within asynchronous functions.
 *
 * @param ms The number of milliseconds to wait.
 * @returns A promise that resolves after the specified delay, returning void.
 * @throws RangeError when the wait duration is outside the bounded range.
 */
export function wait(ms: number, logger: Logger | null = mainLogger): Promise<void> {
  validateIntegerOption(ms, 'ms', 0, MAX_WAIT_MS);

  if (logger) {
    logger.info(`Waiting for ${ms}ms`);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a given asynchronous function with a specified number of retries and delay between retries.
 * Implements an exponential backoff strategy for the delay, which can be customized.
 *
 * @template T The expected return type of the asynchronous function.
 * @param fn A function that returns a promise. This function will be retried upon failure until the retries are exhausted.
 * @param options An object containing the retry options.
 * @param options.retries The number of retries (default is 3).
 * @param options.initialDelay The initial delay in milliseconds before the first retry (default is 300ms).
 * @param options.backoffFactor The factor by which the delay is multiplied for each subsequent retry (default is 2).
 * @param options.maxDelay The maximum delay between retries (default is 30000ms).
 * @param options.jitterRatio Optional bounded jitter ratio from 0 to 1 (default is 0).
 * @param options.random Optional random source used for deterministic jitter tests.
 * @param options.logger Optional logging function to capture retry attempts and errors. Set to `null` to disable logging.
 * @returns A promise that resolves to the value returned by the function `fn` or rejects after all retries are exhausted.
 * @throws Error if all retries are exhausted; RangeError for invalid retry options.
 */
export async function retry<T>({
  fn,
  retries = 3,
  initialDelay = 300,
  backoffFactor = 2,
  maxDelay = 30_000,
  jitterRatio = 0,
  random = Math.random,
  logger = mainLogger, // Use `null` to disable logging
}: RetryOptions<T>): Promise<T> {
  validateIntegerOption(retries, 'retries', 1, MAX_RETRIES);
  validateIntegerOption(initialDelay, 'initialDelay', 0, MAX_WAIT_MS);
  validateFiniteOption(backoffFactor, 'backoffFactor', 1, MAX_BACKOFF_FACTOR);
  validateIntegerOption(maxDelay, 'maxDelay', 0, MAX_WAIT_MS);
  validateFiniteOption(jitterRatio, 'jitterRatio', 0, 1);

  let currentDelay = initialDelay;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (attempt === retries) {
        if (err instanceof Error) {
          if (logger) {
            logger.error(`All ${retries} retries failed. Last error: ${err.message}`);
          }
          throw new Error(`All ${retries} retries failed. Last error: ${err.message}`);
        }

        if (logger) {
          logger.error(`All ${retries} retries failed.`);
        }
        throw new Error(`All ${retries} retries failed.`);
      }

      const cappedDelay = Math.min(currentDelay, maxDelay);
      const delayWithJitter = applyJitter(cappedDelay, jitterRatio, random, maxDelay);

      if (err instanceof Error) {
        if (logger) {
          logger.info(
            `Attempt ${attempt} failed: ${err.message}. Retrying in ${delayWithJitter}ms...`,
          );
        }
      } else {
        if (logger) {
          logger.info(`Attempt ${attempt} failed. Retrying in ${delayWithJitter}ms...`);
        }
      }

      await wait(delayWithJitter, logger);
      currentDelay = Math.min(currentDelay * backoffFactor, maxDelay);
    }
  }

  throw new Error('Retry function reached an unexpected state.');
}
