import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/check-lockfile-drift.mjs');
const LOCKFILE_CHECK_TIMEOUT_MS = 30_000;

const EXPECTED_NPM_ARGS = ['ci', '--ignore-scripts', '--dry-run', '--no-audit', '--fund=false'];

interface FakeNpmResponse {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface FakeNpm {
  readonly argsPath: string;
  readonly binDir: string;
}

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

function createFakeNpm(projectDir: string, response: FakeNpmResponse): FakeNpm {
  const binDir = path.join(projectDir, 'bin');
  mkdirSync(binDir);
  const argsPath = path.join(projectDir, 'npm-args.json');
  const scriptPath = path.join(binDir, 'npm');
  writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env node',
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
      `process.stdout.write(${JSON.stringify(response.stdout)});`,
      `process.stderr.write(${JSON.stringify(response.stderr)});`,
      `process.exit(${response.status});`,
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(scriptPath, 0o755);
  return { argsPath, binDir };
}

function readFakeNpmArgs(fakeNpm: FakeNpm): unknown {
  return JSON.parse(readFileSync(fakeNpm.argsPath, 'utf8'));
}

function runLockfileCheck(projectDir: string, fakeNpm?: FakeNpm): ProcessResult {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: projectDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      PATH:
        fakeNpm === undefined
          ? process.env.PATH
          : `${fakeNpm.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('check-lockfile-drift script', () => {
  it(
    'passes for a synchronized package manifest and lockfile',
    () => {
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
      const fakeNpm = createFakeNpm(projectDir, {
        status: 0,
        stdout: 'npm ci dry-run ok\n',
        stderr: '',
      });

      const result = runLockfileCheck(projectDir, fakeNpm);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Lockfile drift check passed');
      expect(readFakeNpmArgs(fakeNpm)).toEqual(EXPECTED_NPM_ARGS);
    },
    LOCKFILE_CHECK_TIMEOUT_MS,
  );

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

  it(
    'fails with remediation when package.json and package-lock.json drift',
    () => {
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
      const fakeNpm = createFakeNpm(projectDir, {
        status: 1,
        stdout: '',
        stderr: 'npm error package-lock.json missing left-pad\n',
      });

      const result = runLockfileCheck(projectDir, fakeNpm);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('package-lock.json is out of sync with package.json');
      expect(result.stderr).toContain('npm install --package-lock-only');
      expect(result.stderr).toContain('missing left-pad');
      expect(readFakeNpmArgs(fakeNpm)).toEqual(EXPECTED_NPM_ARGS);
    },
    LOCKFILE_CHECK_TIMEOUT_MS,
  );
});
