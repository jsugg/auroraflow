import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseObservabilityBackendValidationCliOptions,
  runObservabilityBackendValidation,
  type ObservabilityBackendValidationOptions,
} from '../../../../../src/framework/observability/backendValidation';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'auroraflow-backend-validation-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function successfulBackendResponse(urlValue: string): Response {
  const url = new URL(urlValue);

  if (url.pathname.endsWith('/api/v1/status/buildinfo')) {
    return jsonResponse({ status: 'success', data: { version: '3.0.1' } });
  }
  if (url.pathname.endsWith('/api/v1/targets')) {
    return jsonResponse({
      status: 'success',
      data: { activeTargets: [{ labels: { job: 'otel-collector' }, health: 'up' }] },
    });
  }
  if (url.pathname.endsWith('/api/v1/query')) {
    return jsonResponse({
      status: 'success',
      data: { result: [{ metric: { __name__: 'auroraflow_test_runs_total' }, value: [1, '1'] }] },
    });
  }
  if (url.pathname.endsWith('/api/health')) {
    return jsonResponse({ database: 'ok' });
  }
  if (url.pathname.endsWith('/api/datasources')) {
    return jsonResponse([{ type: 'prometheus' }, { type: 'elasticsearch' }, { type: 'jaeger' }]);
  }
  if (url.pathname.endsWith('/api/services')) {
    return jsonResponse({ data: ['auroraflow'] });
  }
  if (url.pathname.endsWith('/api/traces')) {
    return jsonResponse({ data: [{ traceID: 'trace-1' }] });
  }
  if (url.pathname.endsWith('/_cluster/health')) {
    return jsonResponse({ status: 'yellow' });
  }
  if (url.pathname.endsWith('/_cat/indices/auroraflow-*')) {
    return jsonResponse([{ index: 'auroraflow-logs-2026.06.26' }]);
  }
  if (url.pathname.endsWith('/api/status')) {
    return jsonResponse({ status: { overall: { level: 'available' } } });
  }
  if (url.pathname.endsWith('/api/saved_objects/_find')) {
    return jsonResponse({ saved_objects: [{ attributes: { title: 'auroraflow-logs-*' } }] });
  }
  return new Response('healthy', { status: 200 });
}

async function createOptions(
  overrides: Partial<ObservabilityBackendValidationOptions> = {},
): Promise<ObservabilityBackendValidationOptions> {
  return {
    ...parseObservabilityBackendValidationCliOptions(
      ['--output-dir', await createTemporaryDirectory(), '--max-attempts', '1'],
      {},
    ),
    ...overrides,
  };
}

describe('parseObservabilityBackendValidationCliOptions', () => {
  it('parses typed readiness and retry controls with safe endpoint defaults', () => {
    const options = parseObservabilityBackendValidationCliOptions(
      [
        '--mode',
        'readiness',
        '--max-attempts',
        '60',
        '--poll-interval-ms',
        '3000',
        '--collector-url',
        'http://collector:13133/',
      ],
      {},
    );

    expect(options.mode).toBe('readiness');
    expect(options.maxAttempts).toBe(60);
    expect(options.pollIntervalMs).toBe(3000);
    expect(options.collectorUrl).toBe('http://collector:13133');
    expect(options.prometheusUrl).toBe('http://127.0.0.1:9090');
  });

  it('rejects unknown modes, credential-bearing URLs, and invalid retry controls', () => {
    expect(() =>
      parseObservabilityBackendValidationCliOptions(['--mode', 'production'], {}),
    ).toThrow('readiness or smoke');
    expect(() =>
      parseObservabilityBackendValidationCliOptions(
        ['--collector-url', 'http://user:secret@collector:13133'],
        {},
      ),
    ).toThrow('must not include credentials');
    expect(() =>
      parseObservabilityBackendValidationCliOptions(['--max-attempts', '0'], {}),
    ).toThrow('between 1 and 300');
  });
});

describe('runObservabilityBackendValidation', () => {
  it('writes typed JSON diagnostics for every readiness and smoke invariant', async () => {
    const options = await createOptions();

    const result = await runObservabilityBackendValidation(options, {
      fetchImpl: async (url) => successfulBackendResponse(url),
      now: () => new Date('2026-06-26T12:00:00.000Z'),
    });

    expect(result.status).toBe('passed');
    expect(result.schemaVersion).toBe('1.0.0');
    expect(result.summary).toEqual({ failed: 0, passed: 12, total: 12 });
    expect(result.checks.map((check) => check.checkId)).toEqual([
      'collector.health',
      'prometheus.readiness',
      'grafana.readiness',
      'jaeger.readiness',
      'elasticsearch.readiness',
      'kibana.readiness',
      'prometheus.collector-target',
      'prometheus.test-runs-series',
      'grafana.datasources',
      'jaeger.auroraflow-trace',
      'elasticsearch.auroraflow-log-index',
      'kibana.auroraflow-log-view',
    ]);
    expect(
      JSON.parse(
        await readFile(
          path.join(options.outputDir, 'observability-backend-validation.json'),
          'utf8',
        ),
      ),
    ).toEqual(result);
  });

  it('retries missing series and records the exact failed query without hiding other checks', async () => {
    const options = await createOptions({ maxAttempts: 2 });
    const sleep = vi.fn(async () => undefined);

    const result = await runObservabilityBackendValidation(options, {
      fetchImpl: async (urlValue) => {
        const url = new URL(urlValue);
        if (url.pathname.endsWith('/api/v1/query')) {
          return jsonResponse({ status: 'success', data: { result: [] } });
        }
        return successfulBackendResponse(urlValue);
      },
      sleep,
    });

    expect(result.status).toBe('failed');
    expect(result.summary).toEqual({ failed: 1, passed: 11, total: 12 });
    expect(result.checks.find((check) => check.status === 'failed')).toMatchObject({
      attempts: 2,
      backend: 'prometheus',
      checkId: 'prometheus.test-runs-series',
      message: 'Prometheus query is missing series auroraflow_test_runs_total.',
    });
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('identifies the exact missing target, data source, trace, index, or data view', async () => {
    const outputRoot = await createTemporaryDirectory();
    const options = parseObservabilityBackendValidationCliOptions(
      ['--output-dir', outputRoot, '--max-attempts', '1'],
      {},
    );
    const cases: readonly {
      readonly checkId: string;
      readonly expectedMessage: string;
      readonly pathname: string;
      readonly response: Response;
    }[] = [
      {
        checkId: 'prometheus.collector-target',
        expectedMessage: 'Prometheus is missing an up target for service otel-collector.',
        pathname: '/api/v1/targets',
        response: jsonResponse({ status: 'success', data: { activeTargets: [] } }),
      },
      {
        checkId: 'grafana.datasources',
        expectedMessage: 'Grafana is missing data source types: jaeger.',
        pathname: '/api/datasources',
        response: jsonResponse([{ type: 'prometheus' }, { type: 'elasticsearch' }]),
      },
      {
        checkId: 'jaeger.auroraflow-trace',
        expectedMessage: 'Jaeger is missing a traceID for service auroraflow.',
        pathname: '/api/traces',
        response: jsonResponse({ data: [] }),
      },
      {
        checkId: 'elasticsearch.auroraflow-log-index',
        expectedMessage: 'Elasticsearch is missing index prefix auroraflow-logs-.',
        pathname: '/_cat/indices/auroraflow-*',
        response: jsonResponse([]),
      },
      {
        checkId: 'kibana.auroraflow-log-view',
        expectedMessage: 'Kibana is missing data view auroraflow-logs-*.',
        pathname: '/api/saved_objects/_find',
        response: jsonResponse({ saved_objects: [] }),
      },
    ];

    for (const testCase of cases) {
      const result = await runObservabilityBackendValidation(
        { ...options, outputDir: path.join(outputRoot, testCase.checkId) },
        {
          fetchImpl: async (urlValue) =>
            new URL(urlValue).pathname.endsWith(testCase.pathname)
              ? testCase.response.clone()
              : successfulBackendResponse(urlValue),
        },
      );

      expect(result.checks.find((check) => check.status === 'failed')).toMatchObject({
        checkId: testCase.checkId,
        message: testCase.expectedMessage,
      });
    }
  });
});
