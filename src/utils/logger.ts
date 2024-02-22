import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: { colorize: true },
      level: process.env.NODE_ENV !== 'production' ? 'info' : 'silent',
    },
    {
      target: 'pino/file',
      options: { destination: './logs/test-runs.log' },
    },
  ],
});

const mainLogger: pino.Logger = pino(transport);
mainLogger.level = logLevel.toLowerCase();

export function getMainLogger(logger: pino.Logger = mainLogger) {
  return logger;
}

export interface Logger {
  info(message: string, ...params: unknown[]): void;
  error(message: string, ...params: unknown[]): void;
  warn(message: string, ...params: unknown[]): void;
  debug(message: string, ...params: unknown[]): void;
}

export function createChildLogger(name: string): Logger {
  return mainLogger.child({ component: name });
}

export function setLogLevel(level: string): void {
  mainLogger.level = level;
}
