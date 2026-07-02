#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REQUIRED_FILES = ['package.json', 'package-lock.json'];
const missingFile = REQUIRED_FILES.find((file) => !existsSync(file));

if (missingFile !== undefined) {
  console.error(
    `::error::Missing ${missingFile}; lockfile drift check requires package.json and package-lock.json.`,
  );
  process.exit(1);
}

const npmArgs = ['ci', '--ignore-scripts', '--dry-run', '--no-audit', '--fund=false'];
const result = spawnSync('npm', npmArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  },
});

if (result.status === 0) {
  console.log('Lockfile drift check passed: package-lock.json is consistent with package.json.');
  process.exit(0);
}

const exitCode = result.status ?? 1;
const output = [result.stderr, result.stdout].filter((text) => text.trim().length > 0).join('\n');

console.error(
  '::error::package-lock.json is out of sync with package.json. Run `npm install --package-lock-only`, commit package.json and package-lock.json together, then rerun `npm run lockfile:check`.',
);
if (output.trim().length > 0) {
  console.error(output.trim());
}
process.exit(exitCode);
