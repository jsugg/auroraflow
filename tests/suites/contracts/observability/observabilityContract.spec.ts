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
      'otel-collector/ci-config.yaml',
      'prometheus/prometheus.yml',
      'prometheus/rules/auroraflow.yml',
      'grafana/provisioning/datasources/datasources.yml',
      'grafana/provisioning/dashboards/dashboards.yml',
      'logstash/config/logstash.yml',
      'logstash/pipeline/auroraflow.conf',
      'elastic/elasticsearch.yml',
      'elastic/ilm/auroraflow-local-retention.json',
      'elastic/index-templates/auroraflow-logs.json',
      'elastic/index-templates/auroraflow-self-healing.json',
      'elastic/index-templates/auroraflow-ci-artifacts.json',
      'elastic/index-templates/auroraflow-ingest-dead-letter.json',
      'kibana/kibana.yml',
      'kibana/saved-objects/auroraflow-log-exploration.ndjson',
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

  it('provides a collector-only CI smoke lane with diagnostics', () => {
    const ciCompose = readFileSync(
      path.join(process.cwd(), 'docker-compose.observability-ci.yml'),
      'utf8',
    );
    const workflow = readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'quality.yml'),
      'utf8',
    );
    const packageJson = readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');

    expect(ciCompose).toContain('otel-collector:');
    expect(ciCompose).toContain('ci-config.yaml');
    expect(ciCompose).not.toContain('elasticsearch:');
    expect(ciCompose).not.toContain('grafana:');
    expect(ciCompose).not.toContain('jaeger:');
    expect(workflow).toContain('observability_stack:');
    expect(workflow).toContain('AURORAFLOW_OBSERVABILITY_CI_ENABLED');
    expect(workflow).toContain('observability-output/ci');
    expect(packageJson).toContain('"observability:ci:smoke"');
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

  it('hardens ELK ingestion with redaction, dead-letter routing, and templates', () => {
    const logstashPipeline = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'logstash', 'pipeline', 'auroraflow.conf'),
      'utf8',
    );

    expect(logstashPipeline).toContain('_jsonparsefailure');
    expect(logstashPipeline).toContain('auroraflow-ingestion-dead-letter');
    expect(logstashPipeline).toContain('auroraflow-ingest-dead-letter-%{+YYYY.MM.dd}');
    expect(logstashPipeline).toContain('secret_key_pattern');
    expect(logstashPipeline).toContain('authorization|cookie|session');
    expect(logstashPipeline).toContain('auroraflow.ingest_schema_version');

    const templatesPath = path.join(OBSERVABILITY_ROOT, 'elastic', 'index-templates');
    for (const templateFile of readdirSync(templatesPath).filter((fileName) =>
      fileName.endsWith('.json'),
    )) {
      const template = JSON.parse(readFileSync(path.join(templatesPath, templateFile), 'utf8')) as {
        index_patterns?: string[];
        template?: {
          mappings?: unknown;
          settings?: Record<string, string | number>;
        };
      };

      expect(template.index_patterns?.[0]).toMatch(/^auroraflow-.+\*$/);
      expect(template.template?.mappings).toBeDefined();
      expect(template.template?.settings?.['index.lifecycle.name']).toBe(
        'auroraflow-local-retention',
      );
    }

    const retentionPolicy = JSON.parse(
      readFileSync(
        path.join(OBSERVABILITY_ROOT, 'elastic', 'ilm', 'auroraflow-local-retention.json'),
        'utf8',
      ),
    ) as {
      policy?: { phases?: { hot?: unknown; delete?: unknown } };
    };
    expect(retentionPolicy.policy?.phases?.hot).toBeDefined();
    expect(retentionPolicy.policy?.phases?.delete).toBeDefined();
  });

  it('ships importable Kibana saved-object NDJSON', () => {
    const savedObjects = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'kibana', 'saved-objects', 'auroraflow-log-exploration.ndjson'),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type?: string; attributes?: { title?: string } });

    expect(savedObjects).toHaveLength(3);
    expect(savedObjects.map((savedObject) => savedObject.attributes?.title)).toEqual(
      expect.arrayContaining([
        'auroraflow-logs-*',
        'auroraflow-self-healing-*',
        'auroraflow-ingest-dead-letter-*',
      ]),
    );
    expect(savedObjects.every((savedObject) => savedObject.type === 'index-pattern')).toBe(true);
  });
});
