import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const DOCKER_COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.yml');
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
    expect(scripts['test:integration:local']).toBe(
      'npm run infra:redis:up && npm run test:integration',
    );
  });
});
