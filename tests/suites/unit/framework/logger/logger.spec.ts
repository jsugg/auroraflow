import type pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  LoggerConfigError,
  createChildLogger,
  createConfiguredLogger,
  resolveLoggerRuntimeConfig,
} from '../../../../../src/utils/logger';
import { SYNTHETIC_SECRET } from '../../../../fixtures/privacy/syntheticSecrets';

function createMemoryDestination(): {
  destination: pino.DestinationStream;
  chunks: string[];
} {
  const chunks: string[] = [];
  return {
    chunks,
    destination: {
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  };
}

describe('resolveLoggerRuntimeConfig', () => {
  it('uses safe defaults for local runs', () => {
    expect(resolveLoggerRuntimeConfig({})).toEqual({
      level: 'info',
      destination: 'both',
      filePath: './logs/test-runs.log',
      redactEnabled: true,
      redactCensor: '[Redacted]',
      redactPaths: expect.arrayContaining([
        'password',
        'token',
        'headers.authorization',
        '*.secret',
      ]),
    });
  });

  it('defaults production logging to file-only destination', () => {
    expect(resolveLoggerRuntimeConfig({ NODE_ENV: 'production' }).destination).toBe('file');
  });

  it('accepts explicit destination, redaction, censor, and file path controls', () => {
    expect(
      resolveLoggerRuntimeConfig({
        AURORAFLOW_LOG_LEVEL: 'debug',
        AURORAFLOW_LOG_DESTINATION: 'console',
        AURORAFLOW_LOG_FILE_PATH: './logs/custom.log',
        AURORAFLOW_LOG_REDACT_ENABLED: 'false',
        AURORAFLOW_LOG_REDACT_PATHS: 'credentials.password, headers.authorization',
        AURORAFLOW_LOG_REDACT_CENSOR: '[hidden]',
      }),
    ).toEqual({
      level: 'debug',
      destination: 'console',
      filePath: './logs/custom.log',
      redactEnabled: false,
      redactPaths: ['credentials.password', 'headers.authorization'],
      redactCensor: '[hidden]',
    });
  });

  it('throws typed errors for invalid config values', () => {
    expect(() =>
      resolveLoggerRuntimeConfig({
        AURORAFLOW_LOG_DESTINATION: 'network',
      }),
    ).toThrow(LoggerConfigError);

    expect(() =>
      resolveLoggerRuntimeConfig({
        AURORAFLOW_LOG_REDACT_ENABLED: 'maybe',
      }),
    ).toThrow(LoggerConfigError);

    expect(() =>
      resolveLoggerRuntimeConfig({
        AURORAFLOW_LOG_REDACT_PATHS: 'password, ',
      }),
    ).toThrow(LoggerConfigError);
  });
});

describe('createConfiguredLogger', () => {
  it('redacts default sensitive fields before writing log records', () => {
    const { chunks, destination } = createMemoryDestination();
    const logger = createConfiguredLogger({
      config: resolveLoggerRuntimeConfig({
        AURORAFLOW_LOG_DESTINATION: 'silent',
      }),
      destination,
    });

    logger.info(
      {
        password: SYNTHETIC_SECRET,
        headers: { authorization: `Bearer ${SYNTHETIC_SECRET}` },
        safeValue: 'visible',
      },
      'user login attempted',
    );

    expect(chunks).toHaveLength(1);
    const payload = JSON.parse(chunks[0]) as {
      password: string;
      headers: { authorization: string };
      safeValue: string;
      msg: string;
    };
    expect(payload.password).toBe('[Redacted]');
    expect(payload.headers.authorization).toBe('[Redacted]');
    expect(payload.safeValue).toBe('visible');
    expect(payload.msg).toBe('user login attempted');
    expect(chunks[0]).not.toContain(SYNTHETIC_SECRET);
  });
});

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
