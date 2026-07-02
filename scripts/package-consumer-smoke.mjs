#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PEER_VERSION = '1.59.1';

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`Missing value for --${key}.`);
    }
    args.set(key, value);
    index += 1;
  }
  return args;
}

function readTarballFromPackReport(packReportPath) {
  const absoluteReportPath = resolve(packReportPath);
  const report = JSON.parse(readFileSync(absoluteReportPath, 'utf8'));
  if (!Array.isArray(report) || report.length !== 1 || typeof report[0]?.filename !== 'string') {
    fail(`Unexpected npm pack report shape in ${packReportPath}.`);
  }

  const filename = report[0].filename;
  return isAbsolute(filename) ? filename : resolve(dirname(absoluteReportPath), filename);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter((text) => text.trim().length > 0).join('\n');
    fail(`${command} ${args.join(' ')} failed in ${cwd} (exit ${result.status ?? 'null'}).\n${output}`);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const packReportPath = args.get('pack-report');
if (packReportPath === undefined) {
  fail('Usage: node scripts/package-consumer-smoke.mjs --pack-report <release-evidence/pack-report.json>');
}

const tarballPath = readTarballFromPackReport(packReportPath);
const tempDir = mkdtempSync(join(tmpdir(), 'auroraflow-consumer-smoke-'));

try {
  writeFileSync(
    join(tempDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {},
        devDependencies: {},
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--fund=false',
      tarballPath,
      `playwright@${PEER_VERSION}`,
      `@playwright/test@${PEER_VERSION}`,
    ],
    tempDir,
  );

  writeFileSync(
    join(tempDir, 'consumer-runtime.mjs'),
    `import { PageFactory, createConfiguredLogger } from 'auroraflow';\n` +
      `import { test, expect } from 'auroraflow/playwright';\n` +
      `if (typeof PageFactory !== 'function') throw new Error('PageFactory export missing');\n` +
      `if (typeof test.extend !== 'function') throw new Error('playwright test export missing');\n` +
      `if (typeof expect !== 'function') throw new Error('playwright expect export missing');\n` +
      `const logger = createConfiguredLogger({ config: { level: 'info', destination: 'console', filePath: './consumer.log', redactEnabled: true, redactPaths: ['token'], redactCensor: '[redacted]' } });\n` +
      `logger.info('auroraflow consumer smoke');\n` +
      `process.exit(0);\n`,
    'utf8',
  );
  run('node', ['consumer-runtime.mjs'], tempDir);

  writeFileSync(
    join(tempDir, 'consumer-types.ts'),
    `import { PageFactory, type AuroraFlowContext } from 'auroraflow';\n` +
      `import { test, expect, type AuroraFlowFixture } from 'auroraflow/playwright';\n` +
      `declare const context: AuroraFlowContext;\n` +
      `declare const fixture: AuroraFlowFixture;\n` +
      `void PageFactory;\n` +
      `void context;\n` +
      `void fixture;\n` +
      `void test;\n` +
      `void expect;\n`,
    'utf8',
  );
  writeFileSync(
    join(tempDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'Node16',
          moduleResolution: 'Node16',
          target: 'ES2022',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['consumer-types.ts'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const tscPath = resolve('node_modules/typescript/bin/tsc');
  run('node', [tscPath, '--project', 'tsconfig.json'], tempDir);

  console.log(`Consumer smoke passed for ${tarballPath}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
