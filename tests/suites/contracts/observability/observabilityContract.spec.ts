import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_METRIC_NAMES } from '../../../../src/framework/observability/metricNames';
import { RESOURCE_ATTRIBUTE_NAMES } from '../../../../src/framework/observability/telemetryConfig';

const CONTRACT_PATH = path.join(process.cwd(), 'docs', 'operations', 'observability-contract.md');
const OBSERVABILITY_ROOT = path.join(process.cwd(), 'observability');

describe('observability contract documentation', () => {
  it('documents every supported live metric name', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const metricName of REQUIRED_METRIC_NAMES) {
      expect(contract).toContain(`\`${metricName}\``);
    }
  });

  it('documents every required resource attribute', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const attributeName of RESOURCE_ATTRIBUTE_NAMES) {
      expect(contract).toContain(`\`${attributeName}\``);
    }
  });

  it('documents no-op defaults and raw selector safeguards', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    expect(contract).toContain('must not export live telemetry unless');
    expect(contract).toContain('Raw selectors');
    expect(contract).toContain('AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true');
  });

  it('provides collector, Prometheus, Grafana, and ELK configuration files', () => {
    const requiredPaths = [
      'otel-collector/config.yaml',
      'prometheus/prometheus.yml',
      'prometheus/rules/auroraflow.yml',
      'grafana/provisioning/datasources/datasources.yml',
      'grafana/provisioning/dashboards/dashboards.yml',
      'logstash/config/logstash.yml',
      'logstash/pipeline/auroraflow.conf',
      'elastic/elasticsearch.yml',
      'kibana/kibana.yml',
      'README.md',
    ] as const;

    for (const requiredPath of requiredPaths) {
      expect(existsSync(path.join(OBSERVABILITY_ROOT, requiredPath))).toBe(true);
    }
  });

  it('wires the collector, Prometheus scrape, and Grafana provisioning contracts', () => {
    const collectorConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'otel-collector', 'config.yaml'),
      'utf8',
    );
    const prometheusConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'prometheus', 'prometheus.yml'),
      'utf8',
    );
    const dataSourcesConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'grafana', 'provisioning', 'datasources', 'datasources.yml'),
      'utf8',
    );

    expect(collectorConfig).toContain('otlp:');
    expect(collectorConfig).toContain('endpoint: 0.0.0.0:4318');
    expect(collectorConfig).toContain('prometheus:');
    expect(collectorConfig).toContain('otlp/jaeger:');
    expect(collectorConfig).toContain('health_check:');
    expect(prometheusConfig).toContain('otel-collector:9464');
    expect(prometheusConfig).toContain('/etc/prometheus/rules/*.yml');
    expect(dataSourcesConfig).toContain('type: prometheus');
    expect(dataSourcesConfig).toContain('type: elasticsearch');
    expect(dataSourcesConfig).toContain('type: jaeger');
  });

  it('ships valid Grafana dashboard JSON files', () => {
    const dashboardPath = path.join(OBSERVABILITY_ROOT, 'grafana', 'dashboards');
    const dashboardFiles = readdirSync(dashboardPath).filter((fileName) =>
      fileName.endsWith('.json'),
    );

    expect(dashboardFiles).toEqual(
      expect.arrayContaining([
        'auroraflow-overview.json',
        'ci-matrix-and-sharding.json',
        'collector-health.json',
        'flakiness-and-retry-pressure.json',
        'self-healing.json',
        'page-actions.json',
        'redis.json',
      ]),
    );

    for (const dashboardFile of dashboardFiles) {
      const dashboard = JSON.parse(
        readFileSync(path.join(dashboardPath, dashboardFile), 'utf8'),
      ) as {
        title?: string;
        panels?: unknown[];
      };

      expect(typeof dashboard.title).toBe('string');
      expect(Array.isArray(dashboard.panels)).toBe(true);
      expect(dashboard.panels?.length).toBeGreaterThan(0);
    }
  });
});
