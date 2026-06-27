import { afterEach, describe, expect, it, vi } from 'vitest';

interface PinoMock {
  readonly factory: ReturnType<typeof vi.fn>;
  readonly transport: ReturnType<typeof vi.fn>;
}

function mockPino(): PinoMock {
  const transport = vi.fn(() => ({ write: vi.fn() }));
  const factory = vi.fn(() => ({ child: vi.fn(), level: 'info' }));
  Object.assign(factory, { transport });
  vi.doMock('pino', () => ({ default: factory }));
  return { factory, transport };
}

describe('logger module import', () => {
  afterEach(() => {
    vi.doUnmock('pino');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not create a logger or transport during import', async () => {
    vi.resetModules();
    vi.stubEnv('AURORAFLOW_LOG_DESTINATION', 'both');
    const pino = mockPino();

    await import('../../../../../src/utils/logger.js');

    expect(pino.factory).not.toHaveBeenCalled();
    expect(pino.transport).not.toHaveBeenCalled();
  });

  it('does not validate logger environment during package import', async () => {
    vi.resetModules();
    vi.stubEnv('AURORAFLOW_LOG_DESTINATION', 'invalid-at-import');
    const pino = mockPino();

    await expect(import('../../../../../src/index.js')).resolves.toBeDefined();
    expect(pino.factory).not.toHaveBeenCalled();
    expect(pino.transport).not.toHaveBeenCalled();
  }, 15_000);
});
