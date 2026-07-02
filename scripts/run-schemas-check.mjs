import { spawnSync } from 'node:child_process';
import process from 'node:process';

function parseCompilerOptions(rawValue) {
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid TS_NODE_COMPILER_OPTIONS: expected a JSON object; received malformed JSON (${detail}).`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid TS_NODE_COMPILER_OPTIONS: expected a JSON object.');
  }
  return parsed;
}

let compilerOptions;
try {
  compilerOptions = parseCompilerOptions(process.env.TS_NODE_COMPILER_OPTIONS ?? '{}');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['-r', 'ts-node/register/transpile-only', 'scripts/schemas-check.ts', ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        ...compilerOptions,
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
