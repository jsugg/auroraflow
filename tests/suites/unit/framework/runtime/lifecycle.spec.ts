import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuroraFlowContext } from '../../../../../src/framework/runtime/auroraFlowContext';
import {
  AuroraFlowCloseError,
  closeAuroraFlow,
  getDefaultAuroraFlowContext,
  isAuroraFlowContextClosed,
  registerAuroraFlowDisposer,
  resetDefaultAuroraFlowContextForTests,
} from '../../../../../src/framework/runtime/lifecycle';

afterEach(() => {
  resetDefaultAuroraFlowContextForTests();
});

describe('closeAuroraFlow', () => {
  it('runs owned disposers once, in reverse registration order', async () => {
    const context = createAuroraFlowContext();
    const order: string[] = [];
    registerAuroraFlowDisposer(
      context,
      () => {
        order.push('first');
      },
      'first',
    );
    registerAuroraFlowDisposer(
      context,
      () => {
        order.push('second');
      },
      'second',
    );
    registerAuroraFlowDisposer(
      context,
      () => {
        order.push('third');
      },
      'third',
    );

    await closeAuroraFlow(context);

    expect(order).toEqual(['third', 'second', 'first']);
    expect(isAuroraFlowContextClosed(context)).toBe(true);
  });

  it('is idempotent: a second close does not re-run disposers', async () => {
    const context = createAuroraFlowContext();
    const dispose = vi.fn();
    registerAuroraFlowDisposer(context, dispose, 'subsystem');

    await closeAuroraFlow(context);
    await closeAuroraFlow(context);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent close calls onto a single operation', async () => {
    const context = createAuroraFlowContext();
    let running = 0;
    let maxConcurrent = 0;
    const dispose = vi.fn(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await Promise.resolve();
      running -= 1;
    });
    registerAuroraFlowDisposer(context, dispose, 'subsystem');

    const first = closeAuroraFlow(context);
    const second = closeAuroraFlow(context);
    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
  });

  it('attempts every disposer and surfaces an aggregate error with per-disposer causes', async () => {
    const context = createAuroraFlowContext();
    const firstError = new Error('first failed');
    const thirdError = new Error('third failed');
    const second = vi.fn();
    registerAuroraFlowDisposer(
      context,
      () => {
        throw firstError;
      },
      'first',
    );
    registerAuroraFlowDisposer(context, second, 'second');
    registerAuroraFlowDisposer(
      context,
      () => {
        throw thirdError;
      },
      'third',
    );

    const error = await closeAuroraFlow(context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuroraFlowCloseError);
    const aggregate = error as AuroraFlowCloseError;
    // Reverse order: third throws, second still runs, first throws — all attempted.
    expect(second).toHaveBeenCalledTimes(1);
    expect(aggregate.failures.map((failure) => failure.name)).toEqual(['third', 'first']);
    expect(aggregate.failures.map((failure) => failure.cause)).toEqual([thirdError, firstError]);
    expect(isAuroraFlowContextClosed(context)).toBe(true);
  });

  it('is a no-op for a context with no registered disposers (disabled subsystems)', async () => {
    const context = createAuroraFlowContext();
    await expect(closeAuroraFlow(context)).resolves.toBeUndefined();
    expect(isAuroraFlowContextClosed(context)).toBe(true);
  });

  it('rejects registration after cleanup has started', async () => {
    const context = createAuroraFlowContext();
    await closeAuroraFlow(context);
    expect(() => registerAuroraFlowDisposer(context, () => undefined, 'late')).toThrow(
      /after cleanup has started/,
    );
  });

  it('closes the lazily-created process default context when called with no argument', async () => {
    const dispose = vi.fn();
    registerAuroraFlowDisposer(getDefaultAuroraFlowContext(), dispose, 'default-subsystem');

    await closeAuroraFlow();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(isAuroraFlowContextClosed(getDefaultAuroraFlowContext())).toBe(true);
  });
});
