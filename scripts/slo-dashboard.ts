import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { FlakinessSummary } from '../src/framework/observability/flakinessReport';
import {
  buildSloDashboard,
  buildSloDashboardMarkdown,
  type SelfHealingGovernanceSummary,
} from '../src/framework/observability/sloDashboard';
import { runSloDashboardTelemetry } from '../src/framework/observability/reportTelemetry';
import { shutdownTelemetry } from '../src/framework/observability/telemetry';
import {
  appendObservabilityTrendPoint,
  buildObservabilityTrendPointFromSloDashboard,
  resolveTrendLimit,
  resolveTrendOutputPath,
} from '../src/framework/observability/trends';

interface CliOptions {
  flakinessJsonPath: string;
  governanceJsonPath?: string;
  outputJsonPath: string;
  outputMarkdownPath: string;
  trendOutput?: string;
  trendLimit: number;
}

const DEFAULT_FLAKINESS_JSON_PATH = path.join('test-results', 'flakiness-summary.json');
const DEFAULT_OUTPUT_JSON_PATH = path.join('test-results', 'slo-dashboard.json');
const DEFAULT_OUTPUT_MARKDOWN_PATH = path.join('test-results', 'slo-dashboard.md');

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    flakinessJsonPath: DEFAULT_FLAKINESS_JSON_PATH,
    outputJsonPath: DEFAULT_OUTPUT_JSON_PATH,
    outputMarkdownPath: DEFAULT_OUTPUT_MARKDOWN_PATH,
    trendOutput: resolveTrendOutputPath(),
    trendLimit: resolveTrendLimit(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--flakiness-json') {
      if (!value) {
        throw new Error('Missing value for --flakiness-json.');
      }
      options.flakinessJsonPath = value;
      index += 1;
      continue;
    }

    if (argument === '--governance-json') {
      if (!value) {
        throw new Error('Missing value for --governance-json.');
      }
      options.governanceJsonPath = value;
      index += 1;
      continue;
    }

    if (argument === '--output-json') {
      if (!value) {
        throw new Error('Missing value for --output-json.');
      }
      options.outputJsonPath = value;
      index += 1;
      continue;
    }

    if (argument === '--output-md') {
      if (!value) {
        throw new Error('Missing value for --output-md.');
      }
      options.outputMarkdownPath = value;
      index += 1;
      continue;
    }
    if (argument === '--trend-output') {
      if (!value) {
        throw new Error('Missing value for --trend-output.');
      }
      options.trendOutput = resolveTrendOutputPath({ value });
      index += 1;
      continue;
    }
    if (argument === '--trend-limit') {
      if (!value) {
        throw new Error('Missing value for --trend-limit.');
      }
      options.trendLimit = resolveTrendLimit({ value });
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertIntegerField(data: Record<string, unknown>, key: keyof FlakinessSummary): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid numeric field in flakiness summary: ${String(key)}`);
  }
  return Math.trunc(value);
}

function parseFlakinessSummary(rawValue: unknown): FlakinessSummary {
  if (!isRecord(rawValue)) {
    throw new Error('Flakiness summary must be an object.');
  }

  const status = rawValue.status;
  if (status !== 'complete' && status !== 'no-input') {
    throw new Error('Flakiness summary has an invalid status field.');
  }

  return {
    generatedAt: String(rawValue.generatedAt ?? ''),
    status,
    sourceFiles: assertIntegerField(rawValue, 'sourceFiles'),
    totalTests: assertIntegerField(rawValue, 'totalTests'),
    flakyTests: assertIntegerField(rawValue, 'flakyTests'),
    failedTests: assertIntegerField(rawValue, 'failedTests'),
    passedTests: assertIntegerField(rawValue, 'passedTests'),
    skippedTests: assertIntegerField(rawValue, 'skippedTests'),
    interruptedTests: assertIntegerField(rawValue, 'interruptedTests'),
    totalAttempts: assertIntegerField(rawValue, 'totalAttempts'),
    totalFailedAttempts: assertIntegerField(rawValue, 'totalFailedAttempts'),
    projectBreakdown: Array.isArray(rawValue.projectBreakdown)
      ? (rawValue.projectBreakdown as FlakinessSummary['projectBreakdown'])
      : [],
    topFlakyCases: Array.isArray(rawValue.topFlakyCases)
      ? (rawValue.topFlakyCases as FlakinessSummary['topFlakyCases'])
      : [],
    testCases: Array.isArray(rawValue.testCases)
      ? (rawValue.testCases as FlakinessSummary['testCases'])
      : [],
  };
}

async function parseJsonFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as unknown;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function main(): Promise<number> {
  return runSloDashboardTelemetry({
    task: async () => {
      const options = parseCliOptions(process.argv.slice(2));

      const flakinessSummary = parseFlakinessSummary(
        await parseJsonFile(options.flakinessJsonPath),
      );
      const governanceSummary = options.governanceJsonPath
        ? ((await parseJsonFile(options.governanceJsonPath)) as SelfHealingGovernanceSummary)
        : undefined;

      const dashboard = buildSloDashboard({
        flakiness: flakinessSummary,
        governance: governanceSummary,
      });
      const markdown = buildSloDashboardMarkdown(dashboard);

      await ensureParentDirectory(options.outputJsonPath);
      await ensureParentDirectory(options.outputMarkdownPath);
      await writeFile(options.outputJsonPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');
      await writeFile(options.outputMarkdownPath, `${markdown}\n`, 'utf8');
      if (options.trendOutput) {
        const trend = await appendObservabilityTrendPoint({
          filePath: options.trendOutput,
          limit: options.trendLimit,
          point: buildObservabilityTrendPointFromSloDashboard({ dashboard }),
        });
        console.log(`Trend history: ${trend.filePath} points=${trend.points}`);
      }

      console.log(
        `SLO dashboard generated: overallStatus=${dashboard.overallStatus} status=${dashboard.status}`,
      );
      console.log(`JSON summary: ${options.outputJsonPath}`);
      console.log(`Markdown summary: ${options.outputMarkdownPath}`);
      return { dashboard, value: 0 };
    },
  });
}

main()
  .then(async (exitCode) => {
    await shutdownTelemetry();
    process.exit(exitCode);
  })
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate SLO dashboard: ${message}`);
    await shutdownTelemetry();
    process.exit(1);
  });
