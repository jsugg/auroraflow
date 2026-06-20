import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectTextIncludes } from '../../../helpers/contractAssertions';

const REPO_ROOT = process.cwd();
const COMMAND_TIMEOUT_MS = 45_000;
const CONTRACT_TIMEOUT_MS = 90_000;

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, args: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: COMMAND_TIMEOUT_MS,
  });

  expect(result.error).toBeUndefined();
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function prepareTempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'auroraflow-pre-push-stamp-'));
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  mkdirSync(path.join(repo, '.husky'), { recursive: true });
  copyFileSync(
    path.join(REPO_ROOT, 'scripts/verify-stamp.mjs'),
    path.join(repo, 'scripts/verify-stamp.mjs'),
  );
  writeFileSync(path.join(repo, 'package.json'), '{"scripts":{}}\n');
  writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  writeFileSync(path.join(repo, '.gitignore'), '.local/\n');
  writeFileSync(path.join(repo, '.husky/pre-push'), 'node scripts/verify-stamp.mjs pre-push\n');

  run('git', ['init'], repo);
  run('git', ['config', 'user.email', 'auroraflow@example.test'], repo);
  run('git', ['config', 'user.name', 'AuroraFlow Test'], repo);
  run('git', ['add', '.'], repo);
  run('git', ['commit', '-m', 'test fixture'], repo);
  return repo;
}

function runStamp(repo: string, command: 'write' | 'check'): CommandResult {
  return run(process.execPath, ['scripts/verify-stamp.mjs', command], repo);
}

describe('pre-push verification stamp contract', () => {
  it(
    'skips only after a clean content-addressed verify stamp',
    () => {
      const repo = prepareTempRepo();

      try {
        const writeResult = runStamp(repo, 'write');
        expect(writeResult.status).toBe(0);
        expect(runStamp(repo, 'check').status).toBe(0);

        writeFileSync(path.join(repo, 'package.json'), '{"scripts":{"changed":"true"}}\n');
        expect(runStamp(repo, 'check').status).not.toBe(0);

        const dirtyWrite = runStamp(repo, 'write');
        expect(dirtyWrite.status).toBe(0);
        expectTextIncludes(dirtyWrite.stdout, {
          text: 'verify stamp skipped: worktree is not clean.',
          rationale: 'Dirty worktrees must never refresh a pre-push skip stamp.',
        });
        expect(runStamp(repo, 'check').status).not.toBe(0);

        const prePushHook = readFileSync(path.join(REPO_ROOT, '.husky/pre-push'), 'utf8').trim();
        expect(prePushHook).toBe('node scripts/verify-stamp.mjs pre-push');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    CONTRACT_TIMEOUT_MS,
  );
});
