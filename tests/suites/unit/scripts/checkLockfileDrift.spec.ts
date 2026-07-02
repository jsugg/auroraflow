import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/check-lockfile-drift.mjs');

interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function createTempProject(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auroraflow-lockfile-check-'));
  temporaryDirectories.add(directory);
  return directory;
}

function writeJson(projectDir: string, fileName: string, payload: unknown): void {
  writeFileSync(path.join(projectDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function runLockfileCheck(projectDir: string): ProcessResult {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('check-lockfile-drift script', () => {
  it('passes for a synchronized package manifest and lockfile', () => {
    const projectDir = createTempProject();
    writeJson(projectDir, 'package.json', {
      name: 'lockfile-ok',
      version: '1.0.0',
    });
    writeJson(projectDir, 'package-lock.json', {
      name: 'lockfile-ok',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'lockfile-ok',
          version: '1.0.0',
        },
      },
    });

    const result = runLockfileCheck(projectDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Lockfile drift check passed');
  });

  it('fails with actionable output when package-lock.json is missing', () => {
    const projectDir = createTempProject();
    writeJson(projectDir, 'package.json', {
      name: 'missing-lockfile',
      version: '1.0.0',
    });

    const result = runLockfileCheck(projectDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing package-lock.json');
  });

  it('fails with remediation when package.json and package-lock.json drift', () => {
    const projectDir = createTempProject();
    writeJson(projectDir, 'package.json', {
      name: 'lockfile-drift',
      version: '1.0.0',
      dependencies: {
        'left-pad': '^1.3.0',
      },
    });
    writeJson(projectDir, 'package-lock.json', {
      name: 'lockfile-drift',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'lockfile-drift',
          version: '1.0.0',
        },
      },
    });

    const result = runLockfileCheck(projectDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('package-lock.json is out of sync with package.json');
    expect(result.stderr).toContain('npm install --package-lock-only');
  });
});
