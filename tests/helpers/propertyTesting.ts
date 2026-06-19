/**
 * Minimal, dependency-free deterministic property-testing utilities (AUR-QE-110).
 *
 * The quality plan requires a bounded property/mutation baseline for
 * calibration-critical code without adding a new test dependency (no
 * `fast-check`/`stryker`) until runtime and tooling are accepted. These helpers
 * provide seeded generation with reproducible failures: a failing case always
 * reports the seed, run index, and generated input, so it can be replayed
 * deterministically by re-running the same spec (the seed fixes the stream).
 */

export type Random = () => number;

/**
 * Deterministic 32-bit PRNG (mulberry32). The same seed always yields the same
 * stream, which is what makes property failures reproducible from a seed.
 */
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns an integer in the inclusive range `[min, max]`. */
export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Returns a finite float in the half-open range `[min, max)`. */
export function randomFloat(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

/** Picks one element from a non-empty list. */
export function randomFrom<T>(random: Random, values: readonly T[]): T {
  return values[randomInt(random, 0, values.length - 1)];
}

/** Coin flip with the given probability of `true` (default 0.5). */
export function randomBoolean(random: Random, probabilityTrue = 0.5): boolean {
  return random() < probabilityTrue;
}

export interface PropertyRunOptions<T> {
  /** Fixed seed; the case stream is fully determined by this value. */
  seed: number;
  /** Bounded number of generated cases. Keep small so unit runtime stays fast. */
  runs: number;
  generate: (random: Random) => T;
  property: (value: T) => void;
}

/**
 * Runs `property` against `runs` deterministically generated cases. On the first
 * failure it rethrows with the seed, run index, and offending input attached, so
 * the exact case is reproducible by re-running the spec with the same seed.
 */
export function forAll<T>({ seed, runs, generate, property }: PropertyRunOptions<T>): void {
  const random = createSeededRandom(seed);
  for (let run = 0; run < runs; run += 1) {
    const value = generate(random);
    try {
      property(value);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Property failed (seed=${seed}, run=${run}, case=${JSON.stringify(value)}): ${reason}`,
        { cause: error },
      );
    }
  }
}
