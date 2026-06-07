import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const DOCKER_COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.yml');
const OBSERVABILITY_COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.observability.yml');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

describe('docker compose infrastructure contract', () => {
  it('defines a Redis service with healthcheck and persistent volume', () => {
    expect(existsSync(DOCKER_COMPOSE_PATH)).toBe(true);

    const composeContent = readFileSync(DOCKER_COMPOSE_PATH, 'utf8');

    expect(composeContent).toContain('services:');
    expect(composeContent).toContain('redis:');
    expect(composeContent).toContain('image: redis:7.2-alpine');
    expect(composeContent).toMatch(/-\s*['"]6379:6379['"]/);
    expect(composeContent).toContain('healthcheck:');
    expect(composeContent).toMatch(/test:\s*\[['"]CMD['"],\s*['"]redis-cli['"],\s*['"]ping['"]\]/);
    expect(composeContent).toContain('volumes:');
    expect(composeContent).toContain('redis-data:/data');
    expect(composeContent).toContain('restart: unless-stopped');
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
    expect(scripts['observability:logs']).toContain('docker compose -f docker-compose.yml');
    expect(scripts['observability:smoke']).toContain('AURORAFLOW_OBSERVABILITY_ENABLED=true');
    expect(scripts['observability:smoke']).toContain('AURORAFLOW_OBSERVABILITY_ENVIRONMENT=local');
    expect(scripts['observability:smoke']).toContain('npm run observability:ci:smoke');
    expect(scripts['test:integration:local']).toBe(
      'npm run infra:redis:up && npm run test:integration',
    );
  });

  it('defines the local observability stack services and health checks', () => {
    expect(existsSync(OBSERVABILITY_COMPOSE_PATH)).toBe(true);

    const composeContent = readFileSync(OBSERVABILITY_COMPOSE_PATH, 'utf8');
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
      expect(composeContent).toContain(`${serviceName}:`);
    }

    expect(composeContent).toContain('127.0.0.1:4318:4318');
    expect(composeContent).toContain('127.0.0.1:9464:9464');
    expect(composeContent).toContain('127.0.0.1:3000:3000');
    expect(composeContent).toContain('127.0.0.1:16686:16686');
    expect(composeContent).toContain('127.0.0.1:5601:5601');
    expect(composeContent).toContain('healthcheck:');
    expect(composeContent).toContain('./observability/otel-collector/config.yaml');
    expect(composeContent).toContain('./observability/grafana/provisioning');
  });
});
