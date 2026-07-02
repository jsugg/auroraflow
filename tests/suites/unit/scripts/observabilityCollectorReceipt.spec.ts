import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SPAN_NAMES } from '../../../../src/framework/observability/attributes';
import { METRIC_NAMES } from '../../../../src/framework/observability/metricNames';
import {
  buildCollectorReceiptLogMarker,
  createCollectorReceiptOtlpPayload,
  emitCollectorReceiptLog,
  evaluateCollectorReceipt,
  parseCollectorReceiptCliOptions,
  runCollectorReceiptAssert,
} from '../../../../scripts/observability-collector-receipt';

const temporaryDirectories: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'auroraflow-collector-receipt-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async (): Promise<void> => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('observability Collector receipt', () => {
  it('builds a run-scoped marker and rejects unsafe run ids', () => {
    expect(buildCollectorReceiptLogMarker('12345')).toBe(
      'auroraflow.observability.collector-receipt.v1:12345',
    );
    expect(buildCollectorReceiptLogMarker()).toBe(
      'auroraflow.observability.collector-receipt.v1:local',
    );
    expect(() => buildCollectorReceiptLogMarker('bad run id')).toThrow(
      'Collector receipt run id must contain 1-128 letters, digits, dots, underscores, or hyphens.',
    );
  });

  it('builds an OTLP JSON log payload with exact receipt identity', () => {
    const marker = buildCollectorReceiptLogMarker('42');

    expect(createCollectorReceiptOtlpPayload(marker, '123000000')).toEqual({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'auroraflow' } },
              { key: 'deployment.environment', value: { stringValue: 'ci' } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'auroraflow.observability-ci' },
              logRecords: [
                {
                  timeUnixNano: '123000000',
                  observedTimeUnixNano: '123000000',
                  severityNumber: 9,
                  severityText: 'INFO',
                  body: { stringValue: marker },
                  attributes: [
                    { key: 'auroraflow.ci.smoke', value: { boolValue: true } },
                    { key: 'auroraflow.receipt.marker', value: { stringValue: marker } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('posts the receipt to the bounded OTLP logs endpoint', async () => {
    const marker = buildCollectorReceiptLogMarker('42');
    let capturedInput: string | undefined;
    let capturedInit: RequestInit | undefined;

    await emitCollectorReceiptLog(
      { endpoint: 'http://collector:4318/', marker, timeoutMs: 1_000 },
      async (input, init): Promise<Response> => {
        capturedInput = input;
        capturedInit = init;
        return new Response('{}', { status: 200 });
      },
    );

    expect(capturedInput).toBe('http://collector:4318/v1/logs');
    expect(capturedInit).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      resourceLogs: [
        {
          scopeLogs: [{ logRecords: [{ body: { stringValue: marker } }] }],
        },
      ],
    });
  });

  it('surfaces OTLP rejection without leaking request data', async () => {
    await expect(
      emitCollectorReceiptLog(
        {
          endpoint: 'http://collector:4318',
          marker: buildCollectorReceiptLogMarker('42'),
        },
        async (): Promise<Response> => new Response('receiver disabled', { status: 503 }),
      ),
    ).rejects.toThrow(
      'Collector rejected OTLP log receipt at http://collector:4318/v1/logs: HTTP 503 (receiver disabled).',
    );
  });

  it('accepts exact metric, span, and run-scoped log evidence', () => {
    const marker = buildCollectorReceiptLogMarker('42');
    const evidence = evaluateCollectorReceipt({
      collectorLogText: `Name: ${SPAN_NAMES.testRun}\nBody: Str(${marker})\n`,
      generatedAt: '2026-07-02T00:00:00.000Z',
      metricsText: `# TYPE ${METRIC_NAMES.testRunsTotal} counter\n${METRIC_NAMES.testRunsTotal}{service_name="auroraflow"} 1\n`,
      runId: '42',
    });

    expect(evidence).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-07-02T00:00:00.000Z',
      passed: true,
      expected: {
        logMarker: marker,
        metricName: METRIC_NAMES.testRunsTotal,
        spanName: SPAN_NAMES.testRun,
      },
      observed: {
        logMarker: true,
        metricName: true,
        metricNames: [METRIC_NAMES.testRunsTotal],
        spanName: true,
      },
      failures: [],
    });
  });

  it.each([
    {
      name: 'metric',
      metricsText: '# no samples\n',
      collectorLogText: `Name: ${SPAN_NAMES.testRun}\nBody: Str(${buildCollectorReceiptLogMarker('42')})\n`,
      failure: `missing metric ${METRIC_NAMES.testRunsTotal}`,
    },
    {
      name: 'span',
      metricsText: `${METRIC_NAMES.testRunsTotal} 1\n`,
      collectorLogText: `Body: Str(${buildCollectorReceiptLogMarker('42')})\n`,
      failure: `missing span ${SPAN_NAMES.testRun}`,
    },
    {
      name: 'log',
      metricsText: `${METRIC_NAMES.testRunsTotal} 1\n`,
      collectorLogText: `Name: ${SPAN_NAMES.testRun}\n`,
      failure: `missing log marker ${buildCollectorReceiptLogMarker('42')}`,
    },
  ])(
    'fails closed when $name evidence is missing',
    ({ collectorLogText, failure, metricsText }) => {
      const evidence = evaluateCollectorReceipt({ collectorLogText, metricsText, runId: '42' });

      expect(evidence.passed).toBe(false);
      expect(evidence.failures).toEqual([failure]);
    },
  );

  it('writes failure diagnostics before rejecting incomplete captured evidence', async () => {
    const directory = await createTempDir();
    const metricsPath = path.join(directory, 'metrics.txt');
    const collectorLogPath = path.join(directory, 'collector.log');
    await Promise.all([
      writeFile(metricsPath, `${METRIC_NAMES.testRunsTotal} 1\n`, 'utf8'),
      writeFile(collectorLogPath, `Name: ${SPAN_NAMES.testRun}\n`, 'utf8'),
    ]);

    await expect(
      runCollectorReceiptAssert({
        collectorLogPath,
        metricsPath,
        outputDir: directory,
        runId: '42',
      }),
    ).rejects.toThrow('Collector receipt assertion failed: missing log marker');

    const written = JSON.parse(
      await readFile(path.join(directory, 'collector-receipt.json'), 'utf8'),
    ) as unknown;
    expect(written).toMatchObject({
      schemaVersion: 1,
      passed: false,
      failures: [`missing log marker ${buildCollectorReceiptLogMarker('42')}`],
    });
  });

  it('parses exact CLI options and rejects duplicate flags', () => {
    expect(
      parseCollectorReceiptCliOptions(
        [
          '--metrics-path',
          'metrics.txt',
          '--collector-log-path',
          'collector.log',
          '--output-dir',
          'output',
        ],
        { GITHUB_RUN_ID: '42' },
      ),
    ).toEqual({
      collectorLogPath: 'collector.log',
      metricsPath: 'metrics.txt',
      outputDir: 'output',
      runId: '42',
    });
    expect(() =>
      parseCollectorReceiptCliOptions(['--metrics-path', 'one', '--metrics-path', 'two']),
    ).toThrow('--metrics-path may be supplied only once.');
  });
});
