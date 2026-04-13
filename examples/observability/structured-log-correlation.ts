export interface CorrelationContext {
  runId: string;
  testId: string;
  component: string;
}

export interface StructuredLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
}

function withContext(
  context: CorrelationContext,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runId: context.runId,
    testId: context.testId,
    component: context.component,
    ...metadata,
  };
}

export function createCorrelatedLogger(
  logger: StructuredLogger,
  context: CorrelationContext,
): StructuredLogger {
  return {
    info(message, metadata) {
      logger.info(message, withContext(context, metadata));
    },
    warn(message, metadata) {
      logger.warn(message, withContext(context, metadata));
    },
    error(message, metadata) {
      logger.error(message, withContext(context, metadata));
    },
    debug(message, metadata) {
      logger.debug(message, withContext(context, metadata));
    },
  };
}

export async function runWithCorrelationContext<TValue>({
  context,
  logger,
  operationName,
  task,
}: {
  context: CorrelationContext;
  logger: StructuredLogger;
  operationName: string;
  task: () => Promise<TValue>;
}): Promise<TValue> {
  const correlatedLogger = createCorrelatedLogger(logger, context);
  correlatedLogger.info('operation_started', { operation: operationName });

  try {
    const result = await task();
    correlatedLogger.info('operation_succeeded', { operation: operationName });
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    correlatedLogger.error('operation_failed', { operation: operationName, errorMessage });
    throw error;
  }
}
