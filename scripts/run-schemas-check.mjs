import { spawnSync } from 'node:child_process';
import process from 'node:process';

const result = spawnSync(
  process.execPath,
  ['-r', 'ts-node/register/transpile-only', 'scripts/schemas-check.ts', ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        ...JSON.parse(process.env.TS_NODE_COMPILER_OPTIONS ?? '{}'),
        rootDir: '.',
      }),
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
