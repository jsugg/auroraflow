import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/mutation-baseline.mjs');
const temporaryDirectories = new Set<string>();

type MutationStatus = 'killed' | 'survived' | 'inapplicable';

interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function createTempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auroraflow-mutation-compare-'));
  temporaryDirectories.add(directory);
  return directory;
}

function writeReport(directory: string, fileName: string, status: MutationStatus): string {
  const reportPath = path.join(directory, fileName);
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        tool: 'auroraflow-mutation-baseline',
        schemaVersion: '1.0.0',
        mutations: [
          {
            id: 'example-mutant',
            area: 'example',
            status,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return reportPath;
}

function runComparison(currentPath: string, baselinePath: string): ProcessResult {
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, '--check-report', currentPath, '--baseline', baselinePath],
    {
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('mutation baseline comparison', () => {
  it.each(['survived', 'inapplicable'] as const)(
    'fails when a previously-killed mutant becomes %s',
    (currentStatus) => {
      const directory = createTempDir();
      const baselinePath = writeReport(directory, 'baseline.json', 'killed');
      const currentPath = writeReport(directory, 'current.json', currentStatus);

      const result = runComparison(currentPath, baselinePath);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Mutation regression: previously-killed mutants now survive or are inapplicable',
      );
      expect(result.stderr).toContain(`example-mutant (example): ${currentStatus}`);
      expect(result.stderr).toContain('update stale mutation definitions');
    },
  );

  it('passes when a previously-killed mutant remains killed', () => {
    const directory = createTempDir();
    const baselinePath = writeReport(directory, 'baseline.json', 'killed');
    const currentPath = writeReport(directory, 'current.json', 'killed');

    const result = runComparison(currentPath, baselinePath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No mutation regressions against the recorded baseline.');
    expect(result.stderr).toBe('');
  });
});
