import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  buildAlertEvaluationMarkdown,
  evaluateAlertPolicy,
  parseAlertPolicy,
  type AlertEvaluationResult,
  type AlertPolicy,
} from '../src/framework/observability/alertPolicies';
import { type SloDashboard } from '../src/framework/observability/sloDashboard';

interface CliOptions {
  dashboardJsonPath: string;
  policyPath: string;
  outputJsonPath: string;
  outputMarkdownPath: string;
  failOnBreach: boolean;
}

const DEFAULT_DASHBOARD_JSON_PATH = path.join('test-results', 'slo-dashboard.json');
const DEFAULT_POLICY_PATH = path.join('configs', 'quality', 'slo-alert-policy.json');
const DEFAULT_OUTPUT_JSON_PATH = path.join('test-results', 'slo-alerts.json');
const DEFAULT_OUTPUT_MARKDOWN_PATH = path.join('test-results', 'slo-alerts.md');

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    dashboardJsonPath: DEFAULT_DASHBOARD_JSON_PATH,
    policyPath: DEFAULT_POLICY_PATH,
    outputJsonPath: DEFAULT_OUTPUT_JSON_PATH,
    outputMarkdownPath: DEFAULT_OUTPUT_MARKDOWN_PATH,
    failOnBreach: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--dashboard-json') {
      if (!value) {
        throw new Error('Missing value for --dashboard-json.');
      }
      options.dashboardJsonPath = value;
      index += 1;
      continue;
    }

    if (argument === '--policy-file') {
      if (!value) {
        throw new Error('Missing value for --policy-file.');
      }
      options.policyPath = value;
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

    if (argument === '--fail-on-breach') {
      options.failOnBreach = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDashboard(rawValue: unknown): SloDashboard {
  if (!isRecord(rawValue)) {
    throw new Error('SLO dashboard payload must be an object.');
  }

  if (
    rawValue.overallStatus !== 'healthy' &&
    rawValue.overallStatus !== 'degraded' &&
    rawValue.overallStatus !== 'insufficient_data'
  ) {
    throw new Error('SLO dashboard overallStatus is invalid.');
  }

  if (!Array.isArray(rawValue.metrics)) {
    throw new Error('SLO dashboard metrics must be an array.');
  }

  return rawValue as unknown as SloDashboard;
}

async function parseJsonFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as unknown;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function emitGithubWarning(message: string): void {
  console.log(`::warning::${message}`);
}

function emitBreachWarnings(result: AlertEvaluationResult): void {
  for (const breach of result.breaches) {
    emitGithubWarning(
      `SLO breach ${breach.id} (${breach.severity}) metric=${breach.metric} actual=${(breach.actualValue * 100).toFixed(2)}% threshold=${breach.operator}${(breach.threshold * 100).toFixed(2)}%`,
    );
  }
}

async function main(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2));

  const dashboard = parseDashboard(await parseJsonFile(options.dashboardJsonPath));
  const policy = parseAlertPolicy((await parseJsonFile(options.policyPath)) as AlertPolicy);

  const result = evaluateAlertPolicy({
    dashboard,
    policy,
  });
  const markdown = buildAlertEvaluationMarkdown(result);

  await ensureParentDirectory(options.outputJsonPath);
  await ensureParentDirectory(options.outputMarkdownPath);
  await writeFile(options.outputJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(options.outputMarkdownPath, `${markdown}\n`, 'utf8');

  if (result.breachCount > 0) {
    emitBreachWarnings(result);
  }

  console.log(
    `SLO alerts evaluated: breaches=${result.breachCount} blockingBreaches=${result.blockingBreachCount}`,
  );
  console.log(`JSON summary: ${options.outputJsonPath}`);
  console.log(`Markdown summary: ${options.outputMarkdownPath}`);

  if (result.blockingBreachCount > 0) {
    console.error('Blocking SLO breaches detected based on configured policy.');
    return 1;
  }

  if (options.failOnBreach && result.breachCount > 0) {
    console.error('SLO breaches detected and --fail-on-breach was set.');
    return 1;
  }

  return 0;
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to evaluate SLO alerts: ${message}`);
    process.exit(1);
  });
