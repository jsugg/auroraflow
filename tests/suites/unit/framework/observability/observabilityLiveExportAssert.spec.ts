import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseObservabilityLiveExportAssertCliOptions,
  runObservabilityLiveExportAssert,
  type ObservabilityLiveExportAssertOptions,
} from '../../../../../scripts/observability-live-export-assert';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'auroraflow-live-assert-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function writeFixtureFiles({
  dashboardExpression,
  root,
}: {
  readonly dashboardExpression: string;
  readonly root: string;
}): Promise<Pick<ObservabilityLiveExportAssertOptions, 'dashboardDir' | 'rulesPath'>> {
  const dashboardDir = path.join(root, 'dashboards');
  const rulesPath = path.join(root, 'rules.yml');
  await mkdir(dashboardDir, { recursive: true });
  await writeFile(
    path.join(dashboardDir, 'overview.json'),
    `${JSON.stringify(
      {
        panels: [
          {
            targets: [
              {
                expr: dashboardExpression,
                legendFormat: '{{auroraflow_test_status}}',
              },
            ],
          },
        ],
        title: 'Fixture',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    rulesPath,
    [
      'groups:',
      '  - name: auroraflow-fixture',
      '    rules:',
      '      - alert: AuroraFlowPassRateLow',
      '        expr: |',
      '          sum(rate(auroraflow_test_cases_total{auroraflow_test_status="passed"}[10m]))',
      '            / clamp_min(sum(rate(auroraflow_test_cases_total[10m])), 1) < 0.95',
      '',
    ].join('\n'),
    'utf8',
  );
  return { dashboardDir, rulesPath };
}

function labelsForMetric(metricName: string): Readonly<Record<string, string>> {
  if (metricName.includes('test_case_duration') || metricName === 'auroraflow_test_cases_total') {
    return {
      auroraflow_project: 'observability-ci',
      auroraflow_shard: '1/1',
      auroraflow_test_status: 'passed',
      ...(metricName.endsWith('_bucket') ? { le: '50' } : {}),
    };
  }
  if (metricName === 'auroraflow_slo_alert_breaches_total') {
    return {
      auroraflow_alert_severity: 'warning',
      auroraflow_slo_metric: 'pass_rate',
    };
  }
  if (metricName.includes('page_action') || metricName === 'auroraflow_page_actions_total') {
    return {
      auroraflow_action_status: 'failed',
      auroraflow_action_type: 'click',
      auroraflow_page_object: 'ObservabilitySmokePage',
      ...(metricName.endsWith('_bucket') ? { le: '50' } : {}),
    };
  }
  if (metricName === 'auroraflow_self_healing_artifacts_total') {
    return {
      auroraflow_action_type: 'click',
      auroraflow_self_heal_mode: 'guarded',
    };
  }
  if (metricName.includes('self_healing_dom_snapshot_duration')) {
    return {
      auroraflow_action_type: 'click',
      auroraflow_page_object: 'ObservabilitySmokePage',
      auroraflow_self_heal_mode: 'guarded',
      auroraflow_self_heal_operation: 'dom_snapshot',
      auroraflow_self_heal_status: 'succeeded',
      ...(metricName.endsWith('_bucket') ? { le: '50' } : {}),
    };
  }
  if (metricName.includes('self_healing_failure_path_duration')) {
    return {
      auroraflow_action_type: 'click',
      auroraflow_page_object: 'ObservabilitySmokePage',
      auroraflow_self_heal_mode: 'guarded',
      auroraflow_self_heal_operation: 'failure_path',
      auroraflow_self_heal_status: 'failed',
      ...(metricName.endsWith('_bucket') ? { le: '50' } : {}),
    };
  }
  if (metricName === 'auroraflow_guarded_validation_candidates_total') {
    return {
      auroraflow_self_heal_status: 'accepted',
      auroraflow_self_heal_strategy: 'role',
    };
  }
  if (metricName === 'auroraflow_guarded_auto_heal_total') {
    return {
      auroraflow_action_type: 'click',
      auroraflow_self_heal_status: 'failed',
    };
  }
  if (
    metricName.includes('redis_operation') ||
    metricName === 'auroraflow_redis_operations_total'
  ) {
    return {
      auroraflow_redis_operation: 'get',
      auroraflow_redis_operation_status: 'failed',
      ...(metricName.endsWith('_bucket') ? { le: '50' } : {}),
    };
  }
  return {
    auroraflow_project: 'observability-ci',
  };
}

function createPrometheusFetch(): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input.toString());
    const pathname = url.pathname;
    if (pathname === '/api/v1/labels') {
      return Response.json({
        data: [
          'auroraflow_action_status',
          'auroraflow_project',
          'auroraflow_test_status',
          'auroraflow_redis_operation_status',
        ],
        status: 'success',
      });
    }
    if (pathname === '/api/v1/rules') {
      return Response.json({
        data: {
          groups: [{ rules: [{ name: 'AuroraFlowPassRateLow', type: 'alerting' }] }],
        },
        status: 'success',
      });
    }

    const metricName =
      url.searchParams.get('match[]') ?? url.searchParams.get('query') ?? 'auroraflow_unknown';
    const metric = {
      __name__: metricName,
      ...labelsForMetric(metricName),
    };

    if (pathname === '/api/v1/series') {
      return Response.json({ data: [metric], status: 'success' });
    }
    if (pathname === '/api/v1/query') {
      return Response.json({
        data: { result: [{ metric, value: [1_767_600_000, '1'] }], resultType: 'vector' },
        status: 'success',
      });
    }
    return Response.json({ error: 'not found', status: 'error' }, { status: 404 });
  };
}

describe('parseObservabilityLiveExportAssertCliOptions', () => {
  it('normalizes CLI and environment inputs', () => {
    const options = parseObservabilityLiveExportAssertCliOptions(
      ['--prometheus-url', 'http://prometheus:9090/', '--max-attempts', '2'],
      {
        AURORAFLOW_OBSERVABILITY_LIVE_ASSERT_OUTPUT_DIR: 'artifacts/live',
        AURORAFLOW_OBSERVABILITY_TIMEOUT_MS: '1500',
      },
    );

    expect(options.prometheusUrl).toBe('http://prometheus:9090');
    expect(options.maxAttempts).toBe(2);
    expect(options.outputDir).toBe('artifacts/live');
    expect(options.timeoutMs).toBe(1500);
  });
});

describe('runObservabilityLiveExportAssert', () => {
  it('writes a Prometheus label snapshot after validating dashboard and rule labels', async () => {
    const root = await createTemporaryDirectory();
    const outputDir = path.join(root, 'output');
    const fixturePaths = await writeFixtureFiles({
      dashboardExpression:
        'sum(rate(auroraflow_test_cases_total{auroraflow_test_status="passed"}[5m])) by (auroraflow_test_status)',
      root,
    });

    const snapshot = await runObservabilityLiveExportAssert(
      {
        ...fixturePaths,
        maxAttempts: 1,
        outputDir,
        pollIntervalMs: 1,
        prometheusUrl: 'http://localhost:9090',
        timeoutMs: 1000,
      },
      createPrometheusFetch(),
    );

    expect(snapshot.metrics.auroraflow_test_cases_total.labelNames).toContain(
      'auroraflow_test_status',
    );
    expect(snapshot.prometheus.rules.loadedAlertNames).toContain('AuroraFlowPassRateLow');
    await expect(
      readFile(path.join(outputDir, 'observability-label-snapshot.json'), 'utf8'),
    ).resolves.toContain('auroraflow_page_actions_total');
  });

  it('fails when dashboards reference labels absent from exported metric series', async () => {
    const root = await createTemporaryDirectory();
    const fixturePaths = await writeFixtureFiles({
      dashboardExpression: 'sum(rate(auroraflow_test_cases_total[5m])) by (status)',
      root,
    });

    await expect(
      runObservabilityLiveExportAssert(
        {
          ...fixturePaths,
          maxAttempts: 1,
          outputDir: path.join(root, 'output'),
          pollIntervalMs: 1,
          prometheusUrl: 'http://localhost:9090',
          timeoutMs: 1000,
        },
        createPrometheusFetch(),
      ),
    ).rejects.toThrow('unknown Prometheus label "status"');
  });
});
