import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface PinoMock {
  readonly factory: ReturnType<typeof vi.fn>;
  readonly transport: ReturnType<typeof vi.fn>;
}

const REPO_ROOT = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
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

  it('does not create a logger or transport during direct logger import', async () => {
    vi.resetModules();
    vi.stubEnv('AURORAFLOW_LOG_DESTINATION', 'both');
    const pino = mockPino();

    await import('../../../../../src/utils/logger.js');

    expect(pino.factory).not.toHaveBeenCalled();
    expect(pino.transport).not.toHaveBeenCalled();
  });

  it('keeps package import as a side-effect-free logger re-export', () => {
    const indexSource = readSource('src/index.ts');
    const loggerSource = readSource('src/utils/logger.ts');

    expect(indexSource).toContain("} from './utils/logger';");
    expect(indexSource).not.toMatch(/(?:getMainLogger|createConfiguredLogger)\s*\(/);
    expect(loggerSource).toContain('mainLogger ??= createConfiguredLogger();');
    expect(loggerSource).not.toMatch(
      /(?:let|const)\s+mainLogger\s*=\s*createConfiguredLogger\s*\(/,
    );
  });
});
