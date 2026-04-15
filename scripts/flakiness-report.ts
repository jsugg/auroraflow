import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  buildFlakinessMarkdown,
  buildFlakinessSummary,
  parseFlakinessReportFile,
  PLAYWRIGHT_REPORT_FILE_PREFIX,
  type FlakinessTestCase,
} from '../src/framework/observability/flakinessReport';

interface CliOptions {
  inputDir: string;
  outputJson: string;
  outputMarkdown: string;
  topLimit: number;
}

const DEFAULT_INPUT_DIR = path.join('test-results');
const DEFAULT_OUTPUT_JSON = path.join('test-results', 'flakiness-summary.json');
const DEFAULT_OUTPUT_MARKDOWN = path.join('test-results', 'flakiness-summary.md');

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputDir: DEFAULT_INPUT_DIR,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMarkdown: DEFAULT_OUTPUT_MARKDOWN,
    topLimit: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--input-dir') {
      if (!value) {
        throw new Error('Missing value for --input-dir.');
      }
      options.inputDir = value;
      index += 1;
      continue;
    }
    if (argument === '--output-json') {
      if (!value) {
        throw new Error('Missing value for --output-json.');
      }
      options.outputJson = value;
      index += 1;
      continue;
    }
    if (argument === '--output-md') {
      if (!value) {
        throw new Error('Missing value for --output-md.');
      }
      options.outputMarkdown = value;
      index += 1;
      continue;
    }
    if (argument === '--top-limit') {
      if (!value) {
        throw new Error('Missing value for --top-limit.');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--top-limit must be a positive integer.');
      }
      options.topLimit = parsed;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function listPlaywrightResultFiles(rootDirectory: string): Promise<string[]> {
  if (!(await directoryExists(rootDirectory))) {
    return [];
  }

  const resultFiles: string[] = [];

  async function walk(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name.startsWith(PLAYWRIGHT_REPORT_FILE_PREFIX) &&
        entry.name.endsWith('.json')
      ) {
        resultFiles.push(fullPath);
      }
    }
  }

  await walk(rootDirectory);
  resultFiles.sort((left, right) => left.localeCompare(right));
  return resultFiles;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function main(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2));
  const reportFiles = await listPlaywrightResultFiles(options.inputDir);
  const allCases: FlakinessTestCase[] = [];

  for (const reportFile of reportFiles) {
    const cases = await parseFlakinessReportFile(reportFile);
    allCases.push(...cases);
  }

  const summary = buildFlakinessSummary({
    sourceFiles: reportFiles.length,
    cases: allCases,
    topLimit: options.topLimit,
  });
  const markdown = buildFlakinessMarkdown(summary);

  await ensureParentDirectory(options.outputJson);
  await ensureParentDirectory(options.outputMarkdown);

  await writeFile(options.outputJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(options.outputMarkdown, `${markdown}\n`, 'utf8');

  console.log(
    `Flakiness report generated: status=${summary.status} sourceFiles=${summary.sourceFiles} flakyTests=${summary.flakyTests} failedTests=${summary.failedTests}`,
  );
  console.log(`JSON summary: ${options.outputJson}`);
  console.log(`Markdown summary: ${options.outputMarkdown}`);

  return 0;
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate flakiness report: ${message}`);
    process.exit(1);
  });
