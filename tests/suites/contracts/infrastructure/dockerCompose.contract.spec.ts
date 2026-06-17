import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getComposeService, readComposeModel } from '../../../helpers/composeModel';

const REPO_ROOT = process.cwd();
const DOCKER_COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.yml');
const OBSERVABILITY_COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.observability.yml');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

function parseShellEnvAssignments(command: string): ReadonlyMap<string, string> {
  const assignments = new Map<string, string>();
  for (const match of command.matchAll(/\b([A-Z0-9_]+)=([^\s]+)/gu)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      assignments.set(key, value);
    }
  }
  return assignments;
}

describe('docker compose infrastructure contract', () => {
  it('defines a Redis service with healthcheck and persistent volume', () => {
    expect(existsSync(DOCKER_COMPOSE_PATH)).toBe(true);

    const compose = readComposeModel('docker-compose.yml');
    const redis = getComposeService(compose, 'redis');

    expect(redis.image).toBe('redis:7.2-alpine');
    expect(redis.ports).toEqual(['6379:6379']);
    expect(redis.healthcheck?.test).toEqual(['CMD', 'redis-cli', 'ping']);
    expect(redis.volumes).toEqual(['redis-data:/data']);
    expect(compose.volumes.has('redis-data')).toBe(true);
    expect(redis.restart).toBe('unless-stopped');
  });

  it('provides npm scripts for compose up/down/logs lifecycle', () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['infra:redis:up']).toBe('docker compose up -d redis');
    expect(scripts['infra:redis:down']).toBe('docker compose down --remove-orphans');
    expect(scripts['infra:redis:logs']).toBe('docker compose logs --tail=200 redis');
    expect(scripts['observability:up']).toBe(
      'docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d',
    );
    expect(scripts['observability:down']).toBe(
      'docker compose -f docker-compose.yml -f docker-compose.observability.yml down --remove-orphans',
    );
    expect(scripts['observability:logs']?.split(/\s+/).slice(0, 4)).toEqual([
      'docker',
      'compose',
      '-f',
      'docker-compose.yml',
    ]);
    expect(parseShellEnvAssignments(scripts['observability:smoke'] ?? '')).toEqual(
      new Map<string, string>([
        ['AURORAFLOW_OBSERVABILITY_ENABLED', 'true'],
        ['AURORAFLOW_OBSERVABILITY_ENVIRONMENT', 'local'],
        ['OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318'],
      ]),
    );
    expect(scripts['observability:smoke']?.endsWith('npm run observability:ci:smoke')).toBe(true);
    expect(scripts['test:integration:local']).toBe(
      'npm run infra:redis:up && npm run test:integration',
    );
  });

  it('defines the local observability stack services and health checks', () => {
    expect(existsSync(OBSERVABILITY_COMPOSE_PATH)).toBe(true);

    const compose = readComposeModel('docker-compose.observability.yml');
    const requiredServices = [
      'otel-collector',
      'prometheus',
      'grafana',
      'jaeger',
      'elasticsearch',
      'logstash',
      'kibana',
    ] as const;

    for (const serviceName of requiredServices) {
      expect(
        compose.services.has(serviceName),
        `Compose stack must define ${serviceName} service.`,
      ).toBe(true);
    }

    expect(getComposeService(compose, 'otel-collector').ports).toEqual(
      expect.arrayContaining(['127.0.0.1:4318:4318', '127.0.0.1:9464:9464']),
    );
    expect(getComposeService(compose, 'grafana').ports).toEqual(['127.0.0.1:3000:3000']);
    expect(getComposeService(compose, 'jaeger').ports).toEqual(['127.0.0.1:16686:16686']);
    expect(getComposeService(compose, 'kibana').ports).toEqual(['127.0.0.1:5601:5601']);
    expect(
      requiredServices.every(
        (serviceName) => getComposeService(compose, serviceName).healthcheck !== undefined,
      ),
      'Every local observability service must define a healthcheck.',
    ).toBe(true);
    expect(getComposeService(compose, 'otel-collector').volumes).toEqual(
      expect.arrayContaining([
        './observability/otel-collector/config.yaml:/etc/otelcol-contrib/config.yaml:ro',
      ]),
    );
    expect(getComposeService(compose, 'grafana').volumes).toEqual(
      expect.arrayContaining(['./observability/grafana/provisioning:/etc/grafana/provisioning:ro']),
    );
  });
});
