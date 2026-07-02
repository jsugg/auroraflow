import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectInvariant,
  expectTextExcludes,
  expectTextIncludes,
  expectTextMatches,
} from '../../../helpers/contractAssertions';
import { getComposeService, readComposeModel } from '../../../helpers/composeModel';
import { getWorkflowJob, getWorkflowStep, readWorkflowModel } from '../../../helpers/workflowModel';
import { REQUIRED_METRIC_NAMES } from '../../../../src/framework/observability/metricNames';
import { RESOURCE_ATTRIBUTE_NAMES } from '../../../../src/framework/observability/telemetryConfig';

const CONTRACT_PATH = path.join(process.cwd(), 'docs', 'operations', 'observability-contract.md');
const SUPPORT_TIERS_PATH = path.join(
  process.cwd(),
  'docs',
  'operations',
  'observability-support-tiers.md',
);
const OBSERVABILITY_ROOT = path.join(process.cwd(), 'observability');
const DOCS_OPERATIONS_ROOT = path.join(process.cwd(), 'docs', 'operations');

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

interface GrafanaDatasource {
  readonly name: string;
  readonly type?: string;
  readonly url?: string;
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonStrings);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(collectJsonStrings);
  }
  return [];
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as PackageJson;
}

function parseIndentedYamlScalars(source: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const stack: Array<{ indent: number; key: string }> = [];

  for (const line of source.split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('-')) {
      continue;
    }
    const match = /^(\s*)([A-Za-z0-9_./-]+):\s*(.*)$/u.exec(line);
    const indentText = match?.[1];
    const key = match?.[2];
    const rawValue = match?.[3];
    if (indentText === undefined || key === undefined || rawValue === undefined) {
      continue;
    }

    const indent = indentText.length;
    while (stack.length > 0 && stack[stack.length - 1]?.indent >= indent) {
      stack.pop();
    }
    const pathParts = [...stack.map((entry) => entry.key), key];
    const value = rawValue.trim();
    if (value.length > 0) {
      values.set(pathParts.join('.'), value.replace(/^['"]|['"]$/gu, ''));
    }
    stack.push({ indent, key });
  }

  return values;
}

function parseGrafanaDatasources(source: string): ReadonlyMap<string, GrafanaDatasource> {
  const datasources = new Map<string, GrafanaDatasource>();
  let current: GrafanaDatasource | undefined;

  for (const line of source.split('\n')) {
    const name = /^ {2}- name:\s*(.+)$/u.exec(line)?.[1];
    if (name !== undefined) {
      current = { name: name.trim() };
      datasources.set(current.name, current);
      continue;
    }

    const property = /^ {4}(type|url):\s*(.+)$/u.exec(line);
    if (current !== undefined && property?.[1] !== undefined && property[2] !== undefined) {
      const key = property[1] as 'type' | 'url';
      current = { ...current, [key]: property[2].trim() };
      datasources.set(current.name, current);
    }
  }

  return datasources;
}

function extractLogstashDirectiveValues(source: string, directive: string): readonly string[] {
  return [...source.matchAll(new RegExp(`${directive} => (?:"([^"]+)"|([^\\s]+))`, 'gu'))].flatMap(
    (match) => {
      const value = match[1] ?? match[2];
      return value === undefined ? [] : [value];
    },
  );
}

describe('observability contract documentation', () => {
  it('documents every supported live metric name', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const metricName of REQUIRED_METRIC_NAMES) {
      expectTextIncludes(contract, {
        text: `\`${metricName}\``,
        rationale: 'Observability contract doc must enumerate every public live metric name.',
      });
    }
  });

  it('documents every required resource attribute', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const attributeName of RESOURCE_ATTRIBUTE_NAMES) {
      expectTextIncludes(contract, {
        text: `\`${attributeName}\``,
        rationale: 'Observability contract doc must enumerate every required resource attribute.',
      });
    }
  });

  it('documents no-op defaults and raw selector safeguards', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');

    for (const text of [
      'must not export live telemetry unless',
      'Raw selectors',
      'AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS=true',
    ]) {
      expectTextIncludes(contract, {
        text,
        rationale:
          'Observability contract doc must preserve no-op and raw-selector safety wording.',
      });
    }
  });

  it('enforces artifact-only, Lite, and Full support-tier boundaries', () => {
    const supportTiers = readFileSync(SUPPORT_TIERS_PATH, 'utf8');
    const liteCompose = readComposeModel('docker-compose.observability-ci.yml');
    const fullCompose = readComposeModel('docker-compose.observability.yml');
    const workflow = readWorkflowModel('.github/workflows/quality.yml');
    const packageJson = readPackageJson();

    expect([...liteCompose.services.keys()]).toEqual(['otel-collector']);
    expect([...fullCompose.services.keys()].sort()).toEqual(
      [
        'elasticsearch',
        'grafana',
        'jaeger',
        'kibana',
        'logstash',
        'otel-collector',
        'prometheus',
      ].sort(),
    );
    expect(getWorkflowJob(workflow, 'observability-stack').name).toBe('Observability Lite Smoke');
    expect(getWorkflowJob(workflow, 'observability-full-stack').name).toBe(
      'Observability Full Stack Smoke',
    );
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        'observability:lite:up': 'docker compose -f docker-compose.observability-ci.yml up -d',
        'observability:lite:down':
          'docker compose -f docker-compose.observability-ci.yml down --remove-orphans',
        'observability:lite:smoke': expect.any(String),
        'observability:up': expect.any(String),
        'observability:down': expect.any(String),
        'observability:smoke': expect.any(String),
      }),
    );

    for (const text of [
      'Artifact-only',
      'Supported default',
      'Lite',
      'Best effort, opt-in',
      'Full',
      'Local/reference only',
      'Production is not a fourth supported tier',
    ]) {
      expectTextIncludes(supportTiers, {
        text,
        rationale: 'Support-tier docs must preserve the public ownership and support boundary.',
      });
    }
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
      'production/README.md',
      'production/docker-compose.yml',
      'production/otel-collector.yaml',
      'production/prometheus.yml',
      'production/prometheus-web.yml',
      'production/grafana.ini',
      'production/elasticsearch.yml',
      'production/kibana.yml',
      'production/tls/README.md',
      'README.md',
    ] as const;

    for (const requiredPath of requiredPaths) {
      expectInvariant(
        existsSync(path.join(OBSERVABILITY_ROOT, requiredPath)),
        `Observability stack must ship ${requiredPath}.`,
      );
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
    const kibanaConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'kibana', 'kibana.yml'),
      'utf8',
    );
    const collectorValues = parseIndentedYamlScalars(collectorConfig);
    const grafanaDatasources = parseGrafanaDatasources(dataSourcesConfig);

    expect(collectorValues.get('receivers.otlp.protocols.http.endpoint')).toBe('0.0.0.0:4318');
    expect(collectorValues.get('exporters.prometheus.endpoint')).toBe('0.0.0.0:9464');
    expect(collectorValues.get('exporters.otlp/jaeger.endpoint')).toBe('jaeger:4317');
    expect(collectorValues.get('extensions.health_check.endpoint')).toBe('0.0.0.0:13133');
    for (const text of ['otel-collector:9464', '/etc/prometheus/rules/*.yml']) {
      expectTextIncludes(prometheusConfig, {
        text,
        rationale: 'Prometheus config must scrape collector metrics and load AuroraFlow rules.',
      });
    }
    expect(grafanaDatasources.get('Prometheus')).toMatchObject({
      type: 'prometheus',
      url: 'http://prometheus:9090',
    });
    expect(grafanaDatasources.get('Elasticsearch')).toMatchObject({
      type: 'elasticsearch',
      url: 'http://elasticsearch:9200',
    });
    expect(grafanaDatasources.get('Jaeger')).toMatchObject({
      type: 'jaeger',
      url: 'http://jaeger:16686',
    });
    expectTextExcludes(kibanaConfig, {
      text: 'xpack.security.enabled',
      rationale: 'Local Kibana config must stay unauthenticated for developer-only stack.',
    });
  });

  it('provides a collector-only Lite CI smoke lane with diagnostics', () => {
    const ciCompose = readComposeModel('docker-compose.observability-ci.yml');
    const workflow = readWorkflowModel('.github/workflows/quality.yml');
    const packageJson = readPackageJson();
    const collectorOnlyJob = getWorkflowJob(workflow, 'observability-stack');
    const collectorConfig = readFileSync(
      path.join(process.cwd(), 'observability', 'otel-collector', 'ci-config.yaml'),
      'utf8',
    );

    expect([...ciCompose.services.keys()]).toEqual(['otel-collector']);
    expect(getComposeService(ciCompose, 'otel-collector').volumes).toEqual([
      './observability/otel-collector/ci-config.yaml:/etc/otelcol-contrib/config.yaml:ro',
    ]);
    const pathFilters =
      getWorkflowStep(
        getWorkflowJob(workflow, 'preflight'),
        'Detect smoke-relevant changes',
      ).with.get('filters') ?? '';
    expectTextIncludes(pathFilters, {
      text: 'observability_stack:',
      rationale: 'Quality preflight must expose observability_stack path filter.',
    });
    expectTextIncludes(pathFilters, {
      text: 'scripts/observability-collector-receipt.ts',
      rationale: 'Collector receipt changes must trigger the Lite evidence lane.',
    });
    expectTextIncludes(collectorOnlyJob.env.get('SHOULD_RUN_OBSERVABILITY') ?? '', {
      text: 'AURORAFLOW_OBSERVABILITY_CI_ENABLED',
      rationale: 'Collector smoke lane must support repository-variable opt-out.',
    });
    expect(collectorOnlyJob.env.get('OBSERVABILITY_DIAGNOSTICS_DIR')).toBe(
      'observability-output/ci',
    );

    const emitStep = getWorkflowStep(collectorOnlyJob, 'Emit smoke telemetry');
    expect(emitStep.env.get('AURORAFLOW_OBSERVABILITY_STRICT')).toBe('true');
    expect(emitStep.env.get('AURORAFLOW_OBSERVABILITY_EMIT_OTLP_LOG')).toBe('true');
    const receiptStep = getWorkflowStep(collectorOnlyJob, 'Assert Lite collector receipt');
    expectTextIncludes(receiptStep.run ?? '', {
      text: 'npm run observability:collector-receipt',
      rationale: 'Lite evidence must use the typed Collector receipt validator.',
    });
    expectTextExcludes(receiptStep.run ?? '', {
      text: 'grep ',
      rationale: 'Receipt semantics belong in typed code, not workflow text matching.',
    });
    const captureStep = getWorkflowStep(collectorOnlyJob, 'Capture observability diagnostics');
    for (const diagnosticPath of [
      'collector-health.txt',
      'collector-metrics.txt',
      'compose-ps.txt',
      'collector.log',
    ]) {
      expectTextIncludes(captureStep.run ?? '', {
        text: diagnosticPath,
        rationale: 'Lite failures must retain actionable Collector diagnostics.',
      });
    }
    expectTextIncludes(collectorConfig, {
      text: 'verbosity: detailed',
      rationale: 'Lite receipt evidence requires span names and OTLP log bodies in Collector logs.',
    });

    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        'observability:ci:smoke': expect.any(String),
        'observability:collector-receipt':
          'node -r ts-node/register scripts/observability-collector-receipt.ts',
        'observability:validate':
          'node -r ts-node/register scripts/observability-validate-backends.ts',
        'observability:snapshot': expect.any(String),
        'observability:live-assert': expect.any(String),
      }),
    );
  });

  it('provides full-stack and secret-gated remote-export CI observability lanes', () => {
    const workflow = readWorkflowModel('.github/workflows/quality.yml');
    const fullStackJob = getWorkflowJob(workflow, 'observability-full-stack');
    const remoteExportJob = getWorkflowJob(workflow, 'observability-remote-export');

    expect(fullStackJob.name).toBe('Observability Full Stack Smoke');
    expect(fullStackJob.env.get('AURORAFLOW_OBSERVABILITY_FULL_STACK_CI_ENABLED')).toBe('true');
    expect(fullStackJob.env.get('SHOULD_RUN_OBSERVABILITY_FULL_STACK')).toBe(
      "${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}",
    );
    expect(fullStackJob.env.get('OBSERVABILITY_DIAGNOSTICS_DIR')).toBe(
      'observability-output/full-stack',
    );
    const readinessStep = getWorkflowStep(fullStackJob, 'Wait for full-stack backends');
    const validationStep = getWorkflowStep(fullStackJob, 'Validate full-stack backend APIs');
    const workflowCommands = fullStackJob.steps.map((step) => step.run ?? '').join('\n');
    expectTextIncludes(readinessStep.run ?? '', {
      text: 'npm run observability:validate',
      rationale: 'Full-stack readiness must delegate API checks to the typed Node validator.',
    });
    expectTextIncludes(validationStep.run ?? '', {
      text: 'npm run observability:validate',
      rationale: 'Full-stack smoke must delegate backend checks to the typed Node validator.',
    });
    expectTextExcludes(workflowCommands, {
      text: 'grep -q',
      rationale: 'Observability workflow must orchestrate typed validators, not grep API payloads.',
    });
    const diagnosticsUpload = getWorkflowStep(fullStackJob, 'Upload full-stack diagnostics');
    expect(diagnosticsUpload.with.get('name')).toBe('observability-full-stack-diagnostics');
    expectTextIncludes(diagnosticsUpload.with.get('path') ?? '', {
      text: 'observability-output/full-stack/',
      rationale: 'Full-stack workflow must upload validator JSON diagnostics.',
    });

    expect(remoteExportJob.name).toBe('Observability Remote Export Smoke');
    expect(remoteExportJob.env.get('AURORAFLOW_OBSERVABILITY_REMOTE_EXPORT_ENABLED')).toBe('true');
    expect(remoteExportJob.env.get('SHOULD_RUN_REMOTE_EXPORT')).toBe(
      "${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}",
    );
    expect(remoteExportJob.env.get('OTEL_EXPORTER_OTLP_ENDPOINT')).toBe(
      '${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}',
    );
    expect(remoteExportJob.env.get('OTEL_EXPORTER_OTLP_HEADERS')).toBe(
      '${{ secrets.OTEL_EXPORTER_OTLP_HEADERS }}',
    );
    expect(
      getWorkflowStep(remoteExportJob, 'Upload remote export diagnostics').with.get('name'),
    ).toBe('observability-remote-export-diagnostics');
  });

  it('uses snapshot-proven Prometheus labels in dashboards and rules', () => {
    const rules = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'prometheus', 'rules', 'auroraflow.yml'),
      'utf8',
    );
    const dashboardStrings = readdirSync(path.join(OBSERVABILITY_ROOT, 'grafana', 'dashboards'))
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) =>
        collectJsonStrings(
          JSON.parse(
            readFileSync(path.join(OBSERVABILITY_ROOT, 'grafana', 'dashboards', fileName), 'utf8'),
          ) as unknown,
        ),
      )
      .flat();

    for (const text of [
      'auroraflow_test_status="passed"',
      'auroraflow_self_heal_status="failed"',
      'auroraflow_redis_operation_status="failed"',
    ]) {
      expectTextIncludes(rules, {
        text,
        rationale: 'Prometheus rules must use snapshot-proven AuroraFlow status labels.',
      });
    }
    expectTextExcludes(rules, {
      text: 'status="failure"',
      rationale: 'Prometheus rules must not use generic status label values.',
    });
    expectInvariant(
      dashboardStrings.some((value) => value.includes('auroraflow_action_status')),
      'Grafana dashboards must query snapshot-proven action status labels.',
    );
    expectInvariant(
      dashboardStrings.some((value) => value.includes('auroraflow_redis_operation_status')),
      'Grafana dashboards must query snapshot-proven Redis status labels.',
    );
    expectInvariant(
      dashboardStrings.every(
        (value) => !value.includes(' by (status)') && !value.includes('{{status}}'),
      ),
      'Grafana dashboards must not group or template by generic status label.',
    );
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

      expectInvariant(
        typeof dashboard.title === 'string',
        `${dashboardFile} must declare a string dashboard title.`,
      );
      expectInvariant(
        Array.isArray(dashboard.panels) && dashboard.panels.length > 0,
        `${dashboardFile} must define at least one dashboard panel.`,
      );
    }
  });

  it('hardens ELK ingestion with redaction, dead-letter routing, and templates', () => {
    const logstashPipeline = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'logstash', 'pipeline', 'auroraflow.conf'),
      'utf8',
    );

    expect(extractLogstashDirectiveValues(logstashPipeline, 'port')).toEqual(
      expect.arrayContaining(['8080']),
    );
    expect(extractLogstashDirectiveValues(logstashPipeline, 'index')).toEqual(
      expect.arrayContaining([
        'auroraflow-ingest-dead-letter-%{+YYYY.MM.dd}',
        'auroraflow-self-healing-%{+YYYY.MM.dd}',
        'auroraflow-logs-%{+YYYY.MM.dd}',
      ]),
    );
    expectTextMatches(logstashPipeline, {
      pattern: /"_jsonparsefailure" in \[tags\]/u,
      rationale: 'Logstash pipeline must route parse failures to dead-letter indices.',
    });
    expectTextMatches(logstashPipeline, {
      pattern: /secret_key_pattern = .+authorization\|cookie\|session/u,
      rationale: 'Logstash pipeline must redact credential-bearing keys.',
    });
    expectTextMatches(logstashPipeline, {
      pattern: /"auroraflow\.ingest_schema_version" => "1"/u,
      rationale: 'Logstash pipeline must tag ingested events with schema version.',
    });

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

      expectTextMatches(template.index_patterns?.[0] ?? '', {
        pattern: /^auroraflow-.+\*$/u,
        rationale: `${templateFile} must target AuroraFlow indices only.`,
      });
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
    expectInvariant(
      savedObjects.every((savedObject) => savedObject.type === 'index-pattern'),
      'Kibana saved objects must all be index-pattern definitions.',
    );
  });

  it('ships production hardening manifests and operator guidance', () => {
    const productionCompose = readComposeModel('observability/production/docker-compose.yml');
    const collectorConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'production', 'otel-collector.yaml'),
      'utf8',
    );
    const grafanaConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'production', 'grafana.ini'),
      'utf8',
    );
    const elasticsearchConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'production', 'elasticsearch.yml'),
      'utf8',
    );
    const kibanaConfig = readFileSync(
      path.join(OBSERVABILITY_ROOT, 'production', 'kibana.yml'),
      'utf8',
    );

    expectInvariant(
      getComposeService(productionCompose, 'otel-collector').environment.has(
        'AURORAFLOW_OTEL_BASIC_AUTH_HTPASSWD',
      ),
      'Production collector service must require a basic-auth htpasswd secret.',
    );
    expectInvariant(
      getComposeService(productionCompose, 'grafana').environment.has('GF_SECURITY_ADMIN_PASSWORD'),
      'Production Grafana service must require an admin password secret.',
    );
    expectInvariant(
      getComposeService(productionCompose, 'elasticsearch').environment.has('ELASTIC_PASSWORD'),
      'Production Elasticsearch service must require an elastic password secret.',
    );
    for (const text of [
      'basicauth/server',
      'cert_file: /run/secrets/auroraflow-observability/tls',
    ]) {
      expectTextIncludes(collectorConfig, {
        text,
        rationale: 'Production collector config must enforce auth and TLS material.',
      });
    }
    for (const text of ['protocol = https', 'enabled = false']) {
      expectTextIncludes(grafanaConfig, {
        text,
        rationale: 'Production Grafana config must serve HTTPS and disable anonymous access.',
      });
    }
    for (const text of ['xpack.security.enabled: true', 'xpack.security.http.ssl.enabled: true']) {
      expectTextIncludes(elasticsearchConfig, {
        text,
        rationale: 'Production Elasticsearch config must enable security and HTTPS.',
      });
    }
    expectTextIncludes(kibanaConfig, {
      text: 'server.ssl.enabled: true',
      rationale: 'Production Kibana config must serve HTTPS.',
    });

    const productionGuide = readFileSync(
      path.join(DOCS_OPERATIONS_ROOT, 'observability-production.md'),
      'utf8',
    );
    const runbooks = readFileSync(
      path.join(DOCS_OPERATIONS_ROOT, 'observability-runbooks.md'),
      'utf8',
    );
    const dashboardChecklist = readFileSync(
      path.join(DOCS_OPERATIONS_ROOT, 'observability-dashboard-review.md'),
      'utf8',
    );

    for (const text of ['Storage Budgets', 'Backup and Restore']) {
      expectTextIncludes(productionGuide, {
        text,
        rationale: 'Production observability guide must preserve operator safety sections.',
      });
    }
    for (const text of ['No Telemetry Arriving', 'Grafana Provisioning Drift']) {
      expectTextIncludes(runbooks, {
        text,
        rationale: 'Observability runbooks must preserve key operator recovery entries.',
      });
    }
    expectTextIncludes(dashboardChecklist, {
      text: 'Prometheus labels remain low-cardinality',
      rationale: 'Dashboard review checklist must preserve cardinality safety invariant.',
    });
  });
});
