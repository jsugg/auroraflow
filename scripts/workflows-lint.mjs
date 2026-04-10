import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createLinter } from 'actionlint';

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
  const workflowsDir = path.resolve('.github/workflows');
  const workflowFiles = await findWorkflowFiles(workflowsDir);
  const runLinter = await createLinter();

  const findings = [];
  for (const filePath of workflowFiles) {
    const content = await readFile(filePath, 'utf8');
    findings.push(...runLinter(content, filePath));
  }

  if (findings.length === 0) {
    console.log('Workflow lint passed.');
    return;
  }

  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${finding.message}`,
    );
  }

  process.exitCode = 1;
}

await main();
