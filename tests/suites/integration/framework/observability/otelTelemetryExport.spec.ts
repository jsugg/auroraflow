import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPAN_NAMES } from '../../../../../src/framework/observability/attributes';
import { METRIC_NAMES } from '../../../../../src/framework/observability/metricNames';
import { createOtelTelemetry } from '../../../../../src/framework/observability/otelTelemetry';
import type { TelemetryDiagnosticLogger } from '../../../../../src/framework/observability/telemetry';
import { resolveTelemetryConfig } from '../../../../../src/framework/observability/telemetryConfig';

interface CapturedOtlpRequest {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

function startOtlpReceiver(
  requests: CapturedOtlpRequest[],
): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      requests.push({
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function expectPayloadContains(request: CapturedOtlpRequest, values: readonly string[]): void {
  expect(request.headers['content-type']).toContain('application/x-protobuf');
  expect(request.headers['content-encoding']).toBeUndefined();
  for (const value of values) {
    expect(request.body.includes(Buffer.from(value))).toBe(true);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OTLP telemetry export', () => {
  it('exports representative spans, metrics, attributes, and resource metadata', async () => {
    const requests: CapturedOtlpRequest[] = [];
    const { server, url } = await startOtlpReceiver(requests);
    const warnings: string[] = [];
    const logger: TelemetryDiagnosticLogger = {
      error: (message) => warnings.push(message),
      warn: (message) => warnings.push(message),
    };
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', url);

    const telemetry = createOtelTelemetry(
      resolveTelemetryConfig({
        AURORAFLOW_OBSERVABILITY_ENABLED: 'true',
        AURORAFLOW_OBSERVABILITY_ENVIRONMENT: 'ci',
        AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS: '1000',
        AURORAFLOW_OBSERVABILITY_SHUTDOWN_TIMEOUT_MS: '5000',
        AURORAFLOW_OBSERVABILITY_SERVICE_NAME: 'auroraflow-otlp-test',
        AURORAFLOW_RUN_ID: 'focused-otlp-run',
        OTEL_EXPORTER_OTLP_ENDPOINT: url,
      }),
      logger,
    );

    try {
      const result = await telemetry.runSpan({
        name: SPAN_NAMES.pageAction,
        attributes: {
          'auroraflow.action.type': 'click',
          'auroraflow.test.marker': 'focused-otlp-span',
        },
        task: async (span) => {
          span.setAttribute('auroraflow.action.status', 'succeeded');
          telemetry.recordCounter(METRIC_NAMES.pageActionsTotal, 1, {
            'auroraflow.action.type': 'click',
            'auroraflow.action.status': 'succeeded',
          });
          telemetry.recordHistogram(METRIC_NAMES.pageActionDurationMs, 12, {
            'auroraflow.action.type': 'click',
          });
          return 'exported';
        },
      });
      expect(result).toBe('exported');
    } finally {
      await telemetry.shutdown();
      await closeServer(server);
    }

    expect(warnings).toEqual([]);
    const traceRequest = requests.find((request) => request.path === '/v1/traces');
    const metricRequest = requests.find((request) => request.path === '/v1/metrics');
    expect(traceRequest).toBeDefined();
    expect(metricRequest).toBeDefined();
    if (!traceRequest || !metricRequest) {
      throw new Error('Expected both trace and metric OTLP requests.');
    }
    expectPayloadContains(traceRequest, [
      SPAN_NAMES.pageAction,
      'auroraflow.action.type',
      'focused-otlp-span',
      'auroraflow-otlp-test',
      'focused-otlp-run',
    ]);
    expectPayloadContains(metricRequest, [
      METRIC_NAMES.pageActionsTotal,
      METRIC_NAMES.pageActionDurationMs,
      'auroraflow.action.status',
      'succeeded',
      'auroraflow-otlp-test',
    ]);
  });
});
