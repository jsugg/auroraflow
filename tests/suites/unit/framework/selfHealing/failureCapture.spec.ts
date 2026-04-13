import { describe, expect, it, vi } from 'vitest';
import { captureFailureEvent } from '../../../../../src/framework/selfHealing/failureCapture';

describe('captureFailureEvent', () => {
  it('returns null and does not write artifacts when self-heal mode is off', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();

    const result = await captureFailureEvent({
      config: { mode: 'off', minConfidence: 0.92 },
      pageObjectName: 'ExamplePage',
      action: {
        type: 'type',
        target: '#username',
        description: 'Error typing in selector #username',
      },
      error: new Error('fill failed'),
      writer,
    });

    expect(result).toBeNull();
    expect(writer).not.toHaveBeenCalled();
  });

  it('captures and writes structured artifacts when mode is suggest', async () => {
    const writer = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue();
    const fixedNow = new Date('2026-04-13T12:00:00.000Z');

    const result = await captureFailureEvent({
      config: { mode: 'suggest', minConfidence: 0.92 },
      pageObjectName: 'ExamplePage',
      currentUrl: 'https://example.test',
      screenshotPath: 'test-results/screenshots/failure.png',
      action: {
        type: 'type',
        target: '#username',
        description: 'Error typing in selector #username',
      },
      error: new Error('fill failed'),
      writer,
      now: () => fixedNow,
      randomSuffix: () => 'abc123',
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      mode: 'suggest',
      pageObjectName: 'ExamplePage',
      currentUrl: 'https://example.test',
      action: {
        type: 'type',
        target: '#username',
        description: 'Error typing in selector #username',
      },
      error: {
        name: 'Error',
        message: 'fill failed',
      },
      artifactVersion: '1.0.0',
      screenshotPath: 'test-results/screenshots/failure.png',
      timestamp: fixedNow.toISOString(),
      eventId: '2026-04-13T12-00-00-000Z_abc123',
    });
    expect(writer).toHaveBeenCalledTimes(1);
  });
});
