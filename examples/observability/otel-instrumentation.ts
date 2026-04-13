type SpanAttributeValue = string | number | boolean;

interface SpanStatus {
  code: 'OK' | 'ERROR';
  message?: string;
}

export interface SpanLike {
  setAttribute(key: string, value: SpanAttributeValue): void;
  recordException(error: Error): void;
  setStatus(status: SpanStatus): void;
  end(): void;
}

export interface TracerLike {
  startSpan(spanName: string): SpanLike;
}

export async function instrumentOperation<TValue>({
  tracer,
  spanName,
  attributes = {},
  task,
}: {
  tracer: TracerLike;
  spanName: string;
  attributes?: Record<string, SpanAttributeValue>;
  task: () => Promise<TValue>;
}): Promise<TValue> {
  const span = tracer.startSpan(spanName);

  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }

  try {
    const result = await task();
    span.setStatus({ code: 'OK' });
    return result;
  } catch (error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error('Unknown error');
    span.recordException(normalizedError);
    span.setStatus({ code: 'ERROR', message: normalizedError.message });
    throw normalizedError;
  } finally {
    span.end();
  }
}
