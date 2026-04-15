import type pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createChildLogger } from '../../../../../src/utils/logger';

describe('createChildLogger', () => {
  it('includes component and correlation metadata in child logger bindings', () => {
    const logger = createChildLogger('CheckoutPage', {
      runId: 'run-123',
      testId: 'test-7',
    }) as unknown as pino.Logger;

    const bindings = logger.bindings();
    expect(bindings.component).toBe('CheckoutPage');
    expect(bindings.runId).toBe('run-123');
    expect(bindings.testId).toBe('test-7');
  });

  it('omits undefined metadata values from bindings', () => {
    const logger = createChildLogger('ProfilePage', {
      runId: 'run-321',
      testId: undefined,
    }) as unknown as pino.Logger;

    const bindings = logger.bindings() as Record<string, unknown>;
    expect(bindings.component).toBe('ProfilePage');
    expect(bindings.runId).toBe('run-321');
    expect(Object.hasOwn(bindings, 'testId')).toBe(false);
  });
});
