import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const REPO_LOCAL_ACTIONLINT = path.resolve('.tools/bin/actionlint');
const WASM_FALLBACK_ENV = 'AURORAFLOW_WORKFLOWS_LINT_ALLOW_WASM';

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function nativeActionlintCandidates() {
  return uniqueValues([
    REPO_LOCAL_ACTIONLINT,
    ...(process.env.PATH ?? '')
      .split(path.delimiter)
      .filter((entry) => entry.length > 0)
      .map((entry) => path.join(entry, 'actionlint')),
    'actionlint',
  ]);
}

function runNativeActionlint() {
  for (const candidate of nativeActionlintCandidates()) {
    const result = spawnSync(candidate, ['-color'], {
      stdio: 'inherit',
      shell: false,
    });

    if (result.error?.code === 'ENOENT') {
      continue;
    }

    if (result.error) {
      console.error(`Failed to execute native actionlint at ${candidate}: ${result.error.message}`);
      process.exitCode = 1;
      return true;
    }

    process.exitCode = result.status ?? 1;
    return true;
  }

  return false;
}

function printNativeInstallInstructions() {
  console.error('Native actionlint was not found.');
  console.error('Install the pinned repo-local binary with: npm run tools:actionlint');
  console.error(`Set ${WASM_FALLBACK_ENV}=true only for diagnostic WASM fallback runs.`);
}

function summarizeWasmError(error) {
  if (error instanceof Error && error.name === 'RuntimeError') {
    return 'WASM actionlint fallback failed inside the runtime.';
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

async function findWorkflowFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findWorkflowFiles(fullPath);
      }
      if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
        return [fullPath];
      }
      return [];
    }),
  );

  return files.flat();
}

async function main() {
  if (runNativeActionlint()) {
    return;
  }

  if (process.env[WASM_FALLBACK_ENV] !== 'true') {
    printNativeInstallInstructions();
    process.exitCode = 1;
    return;
  }

  let createLinter;
  try {
    ({ createLinter } = await import('actionlint'));
  } catch (error) {
    console.error('Failed to load actionlint WASM fallback.');
    console.error(summarizeWasmError(error));
    printNativeInstallInstructions();
    process.exitCode = 1;
    return;
  }

  try {
    const workflowsDir = path.resolve('.github/workflows');
    const workflowFiles = await findWorkflowFiles(workflowsDir);
    const runLinter = await createLinter();

    const findings = [];
    for (const filePath of workflowFiles) {
      const content = await readFile(filePath, 'utf8');
      findings.push(...runLinter(content, filePath));
    }

    const actionableFindings = findings.filter(
      (finding) =>
        // The WASM fallback lags native actionlint's supported GitHub contexts.
        !(finding.kind === 'expression' && finding.message.includes('undefined variable "vars"')),
    );

    if (actionableFindings.length === 0) {
      console.log('Workflow lint passed.');
      return;
    }

    for (const finding of actionableFindings) {
      console.error(
        `${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${finding.message}`,
      );
    }

    process.exitCode = 1;
  } catch (error) {
    console.error('WASM workflow lint fallback failed. Use native actionlint for verification.');
    console.error(summarizeWasmError(error));
    printNativeInstallInstructions();
    process.exitCode = 1;
  }
}

await main();
