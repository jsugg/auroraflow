import { describe, expect, it, vi } from 'vitest';
import {
  createCorrelatedLogger,
  runWithCorrelationContext,
} from '../../../../../examples/observability/structured-log-correlation';

describe('createCorrelatedLogger', () => {
  it('injects correlation context into log payloads', () => {
    const info = vi.fn();
    const error = vi.fn();
    const warn = vi.fn();
    const debug = vi.fn();

    const logger = createCorrelatedLogger(
      { info, error, warn, debug },
      { runId: 'run-1', testId: 'test-7', component: 'example-suite' },
    );

    logger.info('started', { step: 'open-page' });
    logger.error('failed', { reason: 'selector-missing' });

    expect(info).toHaveBeenCalledWith('started', {
      component: 'example-suite',
      runId: 'run-1',
      step: 'open-page',
      testId: 'test-7',
    });
    expect(error).toHaveBeenCalledWith('failed', {
      component: 'example-suite',
      reason: 'selector-missing',
      runId: 'run-1',
      testId: 'test-7',
    });
  });
});

describe('runWithCorrelationContext', () => {
  it('emits start and success events with operation metadata', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const warn = vi.fn();
    const debug = vi.fn();

    const output = await runWithCorrelationContext({
      context: { runId: 'run-2', testId: 'test-9', component: 'example-suite' },
      logger: { info, error, warn, debug },
      operationName: 'fetch-message',
      task: async () => 'ok',
    });

    expect(output).toBe('ok');
    expect(info).toHaveBeenNthCalledWith(1, 'operation_started', {
      component: 'example-suite',
      operation: 'fetch-message',
      runId: 'run-2',
      testId: 'test-9',
    });
    expect(info).toHaveBeenNthCalledWith(2, 'operation_succeeded', {
      component: 'example-suite',
      operation: 'fetch-message',
      runId: 'run-2',
      testId: 'test-9',
    });
  });

  it('emits failure event and rethrows the original error', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const warn = vi.fn();
    const debug = vi.fn();
    const thrown = new Error('network timeout');

    await expect(
      runWithCorrelationContext({
        context: { runId: 'run-3', testId: 'test-1', component: 'example-suite' },
        logger: { info, error, warn, debug },
        operationName: 'fetch-message',
        task: async () => {
          throw thrown;
        },
      }),
    ).rejects.toThrow('network timeout');

    expect(error).toHaveBeenCalledWith('operation_failed', {
      component: 'example-suite',
      errorMessage: 'network timeout',
      operation: 'fetch-message',
      runId: 'run-3',
      testId: 'test-1',
    });
  });
});
