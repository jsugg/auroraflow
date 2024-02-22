/**
 * Waits for a specified number of milliseconds.
 * This function can be used to delay execution within asynchronous functions.
 *
 * @param ms The number of milliseconds to wait.
 * @returns A promise that resolves after the specified delay, returning void.
 */
export function wait(ms: number): Promise<void> {
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
 * @param options.logger Optional logging function to capture retry attempts and errors. Set to `null` to disable logging.
 * @returns A promise that resolves to the value returned by the function `fn` or rejects after all retries are exhausted.
 * @throws Throws an error if all retries are exhausted.
 */
export async function retry<T>({
  fn,
  retries = 3,
  initialDelay = 300,
  backoffFactor = 2,
  logger = console.error, // Use `null` to disable logging
}: {
  fn: () => Promise<T>;
  retries?: number;
  initialDelay?: number;
  backoffFactor?: number;
  logger?: ((...data: unknown[]) => void) | null;
}): Promise<T> {
  let currentDelay = initialDelay;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (logger) {
          logger(
            `Attempt ${attempt} failed: ${err.message}. Retrying in ${currentDelay}ms...`
          );
        }
        if (attempt === retries) {
          throw new Error(
            `All ${retries} retries failed. Last error: ${err.message}`
          );
        }
      } else {
        if (logger) {
          logger(`Attempt ${attempt} failed. Retrying in ${currentDelay}ms...`);
        }
        if (attempt === retries) {
          throw new Error(`All ${retries} retries failed.`);
        }
      }
      await wait(currentDelay);
      currentDelay *= backoffFactor;
    }
  }

  throw new Error('Retry function reached an unexpected state.');
}
