import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildObservabilitySnapshotTargets,
  collectObservabilitySnapshot,
  DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS,
  parseObservabilitySnapshotCliOptions,
  type ObservabilitySnapshotOptions,
} from '../../../../../src/framework/observability/backendSnapshot';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'auroraflow-observability-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('parseObservabilitySnapshotCliOptions', () => {
  it('uses safe local backend defaults', () => {
    const options = parseObservabilitySnapshotCliOptions([], {});

    expect(options).toEqual(DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS);
  });

  it('accepts CLI and environment endpoint overrides', () => {
    const options = parseObservabilitySnapshotCliOptions(
      ['--output-dir', 'artifacts/snapshot', '--prometheus-url', 'http://prometheus:9090/'],
      {
        AURORAFLOW_OBSERVABILITY_GRAFANA_URL: 'http://grafana:3000',
        AURORAFLOW_OBSERVABILITY_TIMEOUT_MS: '1500',
        AURORAFLOW_OBSERVABILITY_SNAPSHOT_ALLOW_PARTIAL: 'true',
      },
    );

    expect(options.outputDir).toBe('artifacts/snapshot');
    expect(options.prometheusUrl).toBe('http://prometheus:9090');
    expect(options.grafanaUrl).toBe('http://grafana:3000');
    expect(options.timeoutMs).toBe(1500);
    expect(options.allowPartial).toBe(true);
  });

  it('rejects non-HTTP endpoints, URL credentials, and invalid timeouts', () => {
    expect(() =>
      parseObservabilitySnapshotCliOptions(['--prometheus-url', 'ftp://prometheus:9090'], {}),
    ).toThrow('http or https');
    expect(() =>
      parseObservabilitySnapshotCliOptions(['--grafana-url', 'http://user:pass@grafana:3000'], {}),
    ).toThrow('credentials');
    expect(() => parseObservabilitySnapshotCliOptions(['--timeout-ms', '0'], {})).toThrow(
      'between 1 and 60000',
    );
  });
});

describe('buildObservabilitySnapshotTargets', () => {
  it('builds the supported backend diagnostic API requests', () => {
    const targets = buildObservabilitySnapshotTargets(DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS);

    expect(targets.map((target) => target.fileName)).toEqual([
      'prometheus-targets.json',
      'prometheus-auroraflow-test-runs.json',
      'prometheus-labels.json',
      'prometheus-series-auroraflow-test-cases.json',
      'prometheus-series-auroraflow-page-actions.json',
      'prometheus-series-auroraflow-guarded-auto-heal.json',
      'prometheus-series-auroraflow-redis-operations.json',
      'prometheus-rules.json',
      'prometheus-query-auroraflow-test-cases.json',
      'prometheus-query-auroraflow-page-actions.json',
      'prometheus-query-auroraflow-guarded-auto-heal.json',
      'prometheus-query-auroraflow-redis-operations.json',
      'grafana-health.json',
      'grafana-datasources.json',
      'jaeger-traces.json',
      'elasticsearch-health.json',
      'elasticsearch-indices.json',
      'kibana-status.json',
      'kibana-data-views.json',
    ]);
    expect(targets.find((target) => target.fileName === 'kibana-data-views.json')?.headers).toEqual(
      {
        'kbn-xsrf': 'auroraflow',
      },
    );
    expect(
      targets.find((target) => target.fileName === 'prometheus-auroraflow-test-runs.json')?.url,
    ).toContain('/api/v1/query?query=auroraflow_test_runs_total');
    expect(
      targets.find((target) => target.fileName === 'prometheus-series-auroraflow-page-actions.json')
        ?.url,
    ).toContain('/api/v1/series?match[]=auroraflow_page_actions_total');
    expect(
      targets.find(
        (target) => target.fileName === 'prometheus-query-auroraflow-redis-operations.json',
      )?.url,
    ).toContain('auroraflow_redis_operation_status');
  });
});

describe('collectObservabilitySnapshot', () => {
  it('writes backend responses and a manifest', async () => {
    const outputDir = await createTemporaryDirectory();
    const options: ObservabilitySnapshotOptions = {
      ...DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS,
      outputDir,
    };
    const requestedUrls: string[] = [];

    const result = await collectObservabilitySnapshot(options, async (url) => {
      requestedUrls.push(url);
      return new Response(JSON.stringify({ url }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    expect(result.failed).toBe(0);
    expect(result.succeeded).toBe(19);
    expect(requestedUrls).toHaveLength(19);
    await expect(
      readFile(path.join(outputDir, 'prometheus-targets.json'), 'utf8'),
    ).resolves.toContain('/api/v1/targets');
    await expect(readFile(path.join(outputDir, 'manifest.json'), 'utf8')).resolves.toContain(
      '"failed": 0',
    );
  });

  it('supports partial snapshots while preserving per-target errors', async () => {
    const outputDir = await createTemporaryDirectory();
    const options: ObservabilitySnapshotOptions = {
      ...DEFAULT_OBSERVABILITY_SNAPSHOT_OPTIONS,
      allowPartial: true,
      outputDir,
    };

    const result = await collectObservabilitySnapshot(options, async (url) => {
      if (url.includes('/api/health')) {
        throw new Error('grafana unavailable');
      }
      return new Response('{}', { status: 200 });
    });

    expect(result.failed).toBe(1);
    await expect(readFile(path.join(outputDir, 'grafana-health.json'), 'utf8')).resolves.toContain(
      'grafana unavailable',
    );
  });
});
