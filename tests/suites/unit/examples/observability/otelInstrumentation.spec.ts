import { describe, expect, it, vi } from 'vitest';
import { instrumentOperation } from '../../../../../examples/observability/otel-instrumentation';

describe('instrumentOperation', () => {
  it('records successful spans with attributes', async () => {
    const setAttribute = vi.fn();
    const recordException = vi.fn();
    const setStatus = vi.fn();
    const end = vi.fn();

    const tracer = {
      startSpan: vi.fn().mockReturnValue({
        setAttribute,
        recordException,
        setStatus,
        end,
      }),
    };

    const result = await instrumentOperation({
      tracer,
      spanName: 'example.fetch',
      attributes: { testId: 'test-1' },
      task: async () => 'payload',
    });

    expect(result).toBe('payload');
    expect(tracer.startSpan).toHaveBeenCalledWith('example.fetch');
    expect(setAttribute).toHaveBeenCalledWith('testId', 'test-1');
    expect(setStatus).toHaveBeenCalledWith({ code: 'OK' });
    expect(end).toHaveBeenCalledTimes(1);
    expect(recordException).not.toHaveBeenCalled();
  });

  it('records exception and marks span as error when task fails', async () => {
    const setAttribute = vi.fn();
    const recordException = vi.fn();
    const setStatus = vi.fn();
    const end = vi.fn();
    const cause = new Error('boom');

    const tracer = {
      startSpan: vi.fn().mockReturnValue({
        setAttribute,
        recordException,
        setStatus,
        end,
      }),
    };

    await expect(
      instrumentOperation({
        tracer,
        spanName: 'example.fetch',
        attributes: { testId: 'test-2' },
        task: async () => {
          throw cause;
        },
      }),
    ).rejects.toThrow('boom');

    expect(setAttribute).toHaveBeenCalledWith('testId', 'test-2');
    expect(recordException).toHaveBeenCalledWith(cause);
    expect(setStatus).toHaveBeenCalledWith({ code: 'ERROR', message: 'boom' });
    expect(end).toHaveBeenCalledTimes(1);
  });
});
