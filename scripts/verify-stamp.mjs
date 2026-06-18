import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const STAMP_SCHEMA_VERSION = 1;
const DEFAULT_STAMP_PATH = path.join('.local', 'verify-stamp.json');
const STAMP_PATH = process.env.AURORAFLOW_VERIFY_STAMP_PATH ?? DEFAULT_STAMP_PATH;
const FINGERPRINT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'eslint.config.mjs',
  'vitest.config.mts',
  'configs/vitest.contracts.mts',
  'configs/vitest.coverage-global.mts',
  '.prettierrc.json',
  '.husky/pre-commit',
  '.husky/pre-push',
  'scripts/run-schemas-check.mjs',
  'scripts/verify-stamp.mjs',
  'scripts/install-actionlint.sh',
  'scripts/workflows-lint.mjs',
];
const PRE_PUSH_FALLBACK_COMMANDS = [
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'test:unit']],
  ['npm', ['run', 'shellcheck']],
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    ...options,
  });
}

function runGit(args) {
  const result = run('git', args);
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function currentHead() {
  return runGit(['rev-parse', 'HEAD']);
}

function worktreeStatus() {
  return runGit(['status', '--porcelain=v1']);
}

function fileDigest(relativePath) {
  if (!existsSync(relativePath)) {
    return null;
  }
  return createHash('sha256').update(readFileSync(relativePath)).digest('hex');
}

function npmVersion() {
  const result = run('npm', ['--version']);
  if (result.error || result.status !== 0) {
    return 'unavailable';
  }
  return result.stdout.trim();
}

function fingerprint() {
  const payload = {
    head: currentHead(),
    node: process.version,
    npm: npmVersion(),
    platform: process.platform,
    arch: process.arch,
    files: Object.fromEntries(FINGERPRINT_FILES.map((file) => [file, fileDigest(file)])),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function readStamp() {
  if (!existsSync(STAMP_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(STAMP_PATH, 'utf8'));
}

function validStamp() {
  const stamp = readStamp();
  if (!stamp || stamp.schemaVersion !== STAMP_SCHEMA_VERSION) {
    return false;
  }
  if (worktreeStatus() !== '') {
    return false;
  }
  return stamp.head === currentHead() && stamp.fingerprint === fingerprint();
}

function writeStamp() {
  if (worktreeStatus() !== '') {
    console.log('verify stamp skipped: worktree is not clean.');
    if (existsSync(STAMP_PATH)) {
      rmSync(STAMP_PATH, { force: true });
    }
    return;
  }

  const stamp = {
    schemaVersion: STAMP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    head: currentHead(),
    fingerprint: fingerprint(),
  };
  mkdirSync(path.dirname(STAMP_PATH), { recursive: true });
  writeFileSync(STAMP_PATH, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`verify stamp written: ${STAMP_PATH}`);
}

function runPrePushFallback() {
  for (const [command, args] of PRE_PUSH_FALLBACK_COMMANDS) {
    const result = run(command, args, { stdio: 'inherit' });
    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

function prePush() {
  if (validStamp()) {
    console.log('pre-push verification skipped: current HEAD already passed npm run verify.');
    return;
  }
  console.log('pre-push verification stamp missing/stale; running local safety gate.');
  runPrePushFallback();
}

const command = process.argv[2];
try {
  if (command === 'write') {
    writeStamp();
  } else if (command === 'check') {
    process.exit(validStamp() ? 0 : 1);
  } else if (command === 'pre-push') {
    prePush();
  } else {
    console.error('Usage: node scripts/verify-stamp.mjs <write|check|pre-push>');
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
