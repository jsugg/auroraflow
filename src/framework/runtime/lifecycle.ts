import { createAuroraFlowContext, type AuroraFlowContext } from './auroraFlowContext';

/**
 * Owned cleanup callback registered against an {@link AuroraFlowContext}. May be
 * synchronous or asynchronous; rejections are collected, never swallowed.
 */
export type AuroraFlowDisposer = () => void | Promise<void>;

/** A single disposer failure surfaced by {@link AuroraFlowCloseError}. */
export interface AuroraFlowDisposerFailure {
  /** Registration name of the disposer that failed. */
  readonly name: string;
  /** Original error thrown by the disposer. */
  readonly cause: unknown;
}

/**
 * Aggregate raised by {@link closeAuroraFlow} when one or more disposers fail.
 * Every disposer is still attempted; the per-disposer causes are preserved on
 * {@link failures} so a failing teardown never hides the remaining cleanup.
 */
export class AuroraFlowCloseError extends Error {
  readonly failures: readonly AuroraFlowDisposerFailure[];

  constructor(failures: readonly AuroraFlowDisposerFailure[]) {
    super(
      `AuroraFlow cleanup failed for ${failures.length} disposer(s): ` +
        failures.map((failure) => failure.name).join(', '),
    );
    this.name = 'AuroraFlowCloseError';
    this.failures = failures;
  }
}

interface RegisteredDisposer {
  readonly dispose: AuroraFlowDisposer;
  readonly name: string;
}

interface DisposerRegistry {
  register(disposer: AuroraFlowDisposer, name?: string): void;
  close(): Promise<void>;
  readonly closed: boolean;
}

function createDisposerRegistry(): DisposerRegistry {
  const disposers: RegisteredDisposer[] = [];
  let closed = false;
  let closePromise: Promise<void> | null = null;

  async function runClose(): Promise<void> {
    const failures: AuroraFlowDisposerFailure[] = [];
    // Reverse registration order: tear down the most recently acquired resource
    // first, and keep going so an early failure never strands later disposers.
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      const registered = disposers[index];
      try {
        await registered.dispose();
      } catch (error: unknown) {
        failures.push({ name: registered.name, cause: error });
      }
    }
    disposers.length = 0;
    if (failures.length > 0) {
      throw new AuroraFlowCloseError(failures);
    }
  }

  return {
    register(disposer, name): void {
      if (closed || closePromise) {
        throw new Error('Cannot register an AuroraFlow disposer after cleanup has started.');
      }
      disposers.push({ dispose: disposer, name: name ?? `disposer-${disposers.length}` });
    },
    close(): Promise<void> {
      // Idempotent: a settled context is a no-op; concurrent calls coalesce onto
      // the single in-flight operation so disposers run at most once.
      if (closed) {
        return Promise.resolve();
      }
      if (closePromise) {
        return closePromise;
      }
      closePromise = runClose().finally(() => {
        closed = true;
        closePromise = null;
      });
      return closePromise;
    },
    get closed(): boolean {
      return closed;
    },
  };
}

const registries = new WeakMap<AuroraFlowContext, DisposerRegistry>();

function registryFor(context: AuroraFlowContext): DisposerRegistry {
  let registry = registries.get(context);
  if (!registry) {
    registry = createDisposerRegistry();
    registries.set(context, registry);
  }
  return registry;
}

let defaultContext: AuroraFlowContext | null = null;

/**
 * Returns the lazily-created process default context that {@link closeAuroraFlow}
 * targets when called with no argument. Creating it does not initialize any
 * subsystem (telemetry/Redis stay lazy), so it is safe to call from cleanup.
 */
export function getDefaultAuroraFlowContext(): AuroraFlowContext {
  defaultContext ??= createAuroraFlowContext();
  return defaultContext;
}

/**
 * Registers an owned cleanup callback for `context`. Disposers run once, in
 * reverse registration order, when {@link closeAuroraFlow} is called for the same
 * context. Throws if cleanup for the context has already started, so a disposer
 * can never be silently dropped.
 */
export function registerAuroraFlowDisposer(
  context: AuroraFlowContext,
  disposer: AuroraFlowDisposer,
  name?: string,
): void {
  registryFor(context).register(disposer, name);
}

/** Reports whether `context` has completed its one-shot cleanup. */
export function isAuroraFlowContextClosed(context: AuroraFlowContext): boolean {
  return registries.get(context)?.closed ?? false;
}

/**
 * Idempotently runs the owned disposers registered for `context` (or the process
 * default context). Concurrent calls coalesce onto one operation; disposers run
 * once in reverse registration order; every disposer is attempted even if an
 * earlier one fails, and failures surface together as an {@link AuroraFlowCloseError}.
 *
 * AuroraFlow only closes resources it created: consumer-owned Playwright `Page`,
 * `BrowserContext`, and `Browser` objects are never closed, and no process-exit
 * hooks are installed. A context with no registered disposers (a disabled
 * subsystem set) closes as a no-op.
 */
export function closeAuroraFlow(context?: AuroraFlowContext): Promise<void> {
  return registryFor(context ?? getDefaultAuroraFlowContext()).close();
}

/** Test-only: drops the cached default context so suites stay isolated. */
export function resetDefaultAuroraFlowContextForTests(): void {
  defaultContext = null;
}
