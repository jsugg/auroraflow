import pino from 'pino';

const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_LOG_FILE_PATH = './logs/test-runs.log';
const DEFAULT_REDACT_CENSOR = '[Redacted]';
const SUPPORTED_LOG_LEVELS = new Set([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);
const SUPPORTED_LOG_DESTINATIONS = new Set(['both', 'console', 'file', 'silent']);
const DEFAULT_REDACT_PATHS = [
  'password',
  'passwd',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization',
  '*.password',
  '*.passwd',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  '*.authorization',
] as const;

export type LogDestination = 'both' | 'console' | 'file' | 'silent';

type Environment = Readonly<Record<string, string | undefined>>;

export class LoggerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoggerConfigError';
  }
}

export interface LoggerRuntimeConfig {
  level: string;
  destination: LogDestination;
  filePath: string;
  redactEnabled: boolean;
  redactPaths: string[];
  redactCensor: string;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function parseBooleanEnv({
  key,
  value,
  defaultValue,
}: {
  key: string;
  value: string | undefined;
  defaultValue: boolean;
}): boolean {
  const normalized = normalizeOptional(value);
  if (normalized === undefined) {
    return defaultValue;
  }

  const lowered = normalized.toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(lowered)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(lowered)) {
    return false;
  }

  throw new LoggerConfigError(`${key} must be a boolean-like value. Received: ${value}`);
}

function normalizeLogLevel(rawLevel: string | undefined): string {
  const normalizedLevel = (normalizeOptional(rawLevel) ?? DEFAULT_LOG_LEVEL).toLowerCase();
  if (!SUPPORTED_LOG_LEVELS.has(normalizedLevel)) {
    throw new LoggerConfigError(
      `LOG_LEVEL must be one of ${[...SUPPORTED_LOG_LEVELS].join(', ')}.`,
    );
  }
  return normalizedLevel;
}

function defaultDestination(env: Environment): LogDestination {
  return env.NODE_ENV === 'production' ? 'file' : 'both';
}

function normalizeDestination(
  rawDestination: string | undefined,
  env: Environment,
): LogDestination {
  const normalizedDestination = (
    normalizeOptional(rawDestination) ?? defaultDestination(env)
  ).toLowerCase();
  if (!SUPPORTED_LOG_DESTINATIONS.has(normalizedDestination)) {
    throw new LoggerConfigError(
      `AURORAFLOW_LOG_DESTINATION must be one of ${[...SUPPORTED_LOG_DESTINATIONS].join(', ')}.`,
    );
  }
  return normalizedDestination as LogDestination;
}

function normalizeFilePath(rawPath: string | undefined): string {
  const normalizedPath = normalizeOptional(rawPath) ?? DEFAULT_LOG_FILE_PATH;
  if (normalizedPath.includes('\0')) {
    throw new LoggerConfigError('AURORAFLOW_LOG_FILE_PATH must not contain NUL bytes.');
  }
  if (normalizedPath.length > 4096) {
    throw new LoggerConfigError('AURORAFLOW_LOG_FILE_PATH must be 4096 characters or less.');
  }
  return normalizedPath;
}

function normalizeRedactPath(rawPath: string): string {
  const normalizedPath = rawPath.trim();
  if (normalizedPath.length === 0) {
    throw new LoggerConfigError('AURORAFLOW_LOG_REDACT_PATHS must not contain empty entries.');
  }
  if (normalizedPath.length > 256) {
    throw new LoggerConfigError(
      'AURORAFLOW_LOG_REDACT_PATHS entries must be 256 characters or less.',
    );
  }
  if (/[\0\r\n]/.test(normalizedPath)) {
    throw new LoggerConfigError(
      'AURORAFLOW_LOG_REDACT_PATHS entries must not contain control lines.',
    );
  }
  return normalizedPath;
}

function normalizeRedactPaths(rawPaths: string | undefined): string[] {
  const normalizedPaths = normalizeOptional(rawPaths);
  if (normalizedPaths === undefined) {
    return [...DEFAULT_REDACT_PATHS];
  }

  return [...new Set(normalizedPaths.split(',').map(normalizeRedactPath))];
}

function normalizeRedactCensor(rawCensor: string | undefined): string {
  const normalizedCensor = normalizeOptional(rawCensor) ?? DEFAULT_REDACT_CENSOR;
  if (normalizedCensor.includes('\0')) {
    throw new LoggerConfigError('AURORAFLOW_LOG_REDACT_CENSOR must not contain NUL bytes.');
  }
  if (normalizedCensor.length > 128) {
    throw new LoggerConfigError('AURORAFLOW_LOG_REDACT_CENSOR must be 128 characters or less.');
  }
  return normalizedCensor;
}

export function resolveLoggerRuntimeConfig(env: Environment = process.env): LoggerRuntimeConfig {
  return {
    level: normalizeLogLevel(env.AURORAFLOW_LOG_LEVEL ?? env.LOG_LEVEL),
    destination: normalizeDestination(env.AURORAFLOW_LOG_DESTINATION, env),
    filePath: normalizeFilePath(env.AURORAFLOW_LOG_FILE_PATH),
    redactEnabled: parseBooleanEnv({
      key: 'AURORAFLOW_LOG_REDACT_ENABLED',
      value: env.AURORAFLOW_LOG_REDACT_ENABLED,
      defaultValue: true,
    }),
    redactPaths: normalizeRedactPaths(env.AURORAFLOW_LOG_REDACT_PATHS),
    redactCensor: normalizeRedactCensor(env.AURORAFLOW_LOG_REDACT_CENSOR),
  };
}

function buildTransportTargets(config: LoggerRuntimeConfig): pino.TransportTargetOptions[] {
  const targets: pino.TransportTargetOptions[] = [];
  if (config.destination === 'both' || config.destination === 'console') {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true },
      level: config.level,
    });
  }

  if (config.destination === 'both' || config.destination === 'file') {
    targets.push({
      target: 'pino/file',
      options: { destination: config.filePath },
      level: config.level,
    });
  }

  return targets;
}

function buildLoggerOptions(config: LoggerRuntimeConfig): pino.LoggerOptions {
  return {
    level: config.level,
    ...(config.redactEnabled
      ? {
          redact: {
            paths: config.redactPaths,
            censor: config.redactCensor,
          },
        }
      : {}),
  };
}

export function createConfiguredLogger({
  config = resolveLoggerRuntimeConfig(),
  destination,
}: {
  config?: LoggerRuntimeConfig;
  destination?: pino.DestinationStream;
} = {}): pino.Logger {
  const loggerOptions = buildLoggerOptions(config);
  if (destination) {
    return pino(loggerOptions, destination);
  }

  const transportTargets = buildTransportTargets(config);
  if (transportTargets.length === 0) {
    return pino({ ...loggerOptions, enabled: false });
  }

  return pino(loggerOptions, pino.transport({ targets: transportTargets }));
}

const mainLogger: pino.Logger = createConfiguredLogger();

export function getMainLogger(logger: pino.Logger = mainLogger): pino.Logger {
  return logger;
}

export interface Logger {
  info(message: string, ...params: unknown[]): void;
  error(message: string, ...params: unknown[]): void;
  warn(message: string, ...params: unknown[]): void;
  debug(message: string, ...params: unknown[]): void;
}

function buildChildBindings({
  component,
  metadata,
}: {
  component: string;
  metadata: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const bindings: Record<string, string> = { component };
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      bindings[key] = value;
    }
  }
  return bindings;
}

export function createChildLogger(
  name: string,
  metadata: Readonly<Record<string, string | undefined>> = {},
): Logger {
  return mainLogger.child(
    buildChildBindings({
      component: name,
      metadata,
    }),
  );
}

export function setLogLevel(level: string): void {
  mainLogger.level = normalizeLogLevel(level);
}
