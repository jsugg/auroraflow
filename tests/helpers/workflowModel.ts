import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface WorkflowStep {
  readonly name: string;
  readonly run?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly env: ReadonlyMap<string, string>;
  readonly with: ReadonlyMap<string, string>;
  readonly raw: string;
}

export interface WorkflowJob {
  readonly id: string;
  readonly name?: string;
  readonly needs: readonly string[];
  readonly uses?: string;
  readonly if?: string;
  readonly environment?: string;
  readonly permissions: ReadonlyMap<string, string>;
  readonly env: ReadonlyMap<string, string>;
  readonly steps: readonly WorkflowStep[];
  readonly raw: string;
}

export interface WorkflowModel {
  readonly raw: string;
  readonly permissions: ReadonlyMap<string, string>;
  readonly env: ReadonlyMap<string, string>;
  readonly jobs: ReadonlyMap<string, WorkflowJob>;
}

/** Parses the GitHub Actions subset used by repository workflow contracts. */
export function readWorkflowModel(relativePath: string): WorkflowModel {
  const raw = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  return {
    raw,
    permissions: parseTopLevelMap(raw, 'permissions'),
    env: parseTopLevelMap(raw, 'env'),
    jobs: parseJobs(raw),
  };
}

export function getWorkflowJob(workflow: WorkflowModel, jobId: string): WorkflowJob {
  const job = workflow.jobs.get(jobId);
  if (job === undefined) {
    throw new Error(`Workflow job not found: ${jobId}`);
  }
  return job;
}

export function getWorkflowStep(job: WorkflowJob, stepName: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === stepName);
  if (step === undefined) {
    throw new Error(`Workflow step not found in ${job.id}: ${stepName}`);
  }
  return step;
}

function parseJobs(raw: string): Map<string, WorkflowJob> {
  const jobsSection = extractTopLevelSection(raw, 'jobs');
  if (jobsSection === undefined) {
    return new Map();
  }

  const jobs = new Map<string, WorkflowJob>();
  const jobHeaders = [...jobsSection.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*\n/gm)];

  for (let index = 0; index < jobHeaders.length; index += 1) {
    const header = jobHeaders[index];
    const jobId = header[1];
    if (jobId === undefined) {
      continue;
    }

    const start = header.index ?? 0;
    const nextHeader = jobHeaders[index + 1];
    const end = nextHeader?.index ?? jobsSection.length;
    const jobBlock = jobsSection.slice(start, end);

    jobs.set(jobId, {
      id: jobId,
      name: parseScalarMatch(jobBlock, /^ {4}name:\s*(.+)$/m),
      needs: parseNeeds(jobBlock),
      uses: parseScalarMatch(jobBlock, /^ {4}uses:\s*(.+)$/m),
      if: parseScalarMatch(jobBlock, /^ {4}if:\s*(.+)$/m),
      environment: parseScalarMatch(jobBlock, /^ {4}environment:\s*(.+)$/m),
      permissions: parseNestedMap(jobBlock, 4, 'permissions', 6),
      env: parseNestedMap(jobBlock, 4, 'env', 6),
      steps: parseSteps(jobBlock),
      raw: jobBlock,
    });
  }

  return jobs;
}

function parseSteps(jobBlock: string): WorkflowStep[] {
  const stepHeaders = [...jobBlock.matchAll(/^ {6}- name:\s*(.+)$/gm)];
  const steps: WorkflowStep[] = [];

  for (let index = 0; index < stepHeaders.length; index += 1) {
    const header = stepHeaders[index];
    const stepName = header[1];
    if (stepName === undefined) {
      continue;
    }

    const start = header.index ?? 0;
    const nextHeader = stepHeaders[index + 1];
    const end = nextHeader?.index ?? jobBlock.length;
    const stepBlock = jobBlock.slice(start, end);

    steps.push({
      name: parseScalar(stepName),
      run: parseRun(stepBlock),
      uses: parseScalarMatch(stepBlock, /^ {8}uses:\s*(.+)$/m),
      if: parseScalarMatch(stepBlock, /^ {8}if:\s*(.+)$/m),
      env: parseNestedMap(stepBlock, 8, 'env', 10),
      with: parseNestedMap(stepBlock, 8, 'with', 10),
      raw: stepBlock,
    });
  }

  return steps;
}

function parseRun(stepBlock: string): string | undefined {
  const singleLineRun = /^ {8}run:\s*(.+)$/m.exec(stepBlock);
  if (singleLineRun?.[1] !== undefined && !['|', '>'].includes(singleLineRun[1].trim())) {
    return parseScalar(singleLineRun[1]);
  }

  const blockRun = /^ {8}run:\s*[|>]\s*$/m.exec(stepBlock);
  if (blockRun?.index === undefined) {
    return undefined;
  }

  const blockStart = blockRun.index + blockRun[0].length;
  const lines = stepBlock.slice(blockStart).split('\n');
  const runLines: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      runLines.push('');
      continue;
    }

    const indent = leadingSpaces(line);
    if (indent <= 8) {
      break;
    }
    runLines.push(line.startsWith('          ') ? line.slice(10) : line.trimStart());
  }

  return runLines.join('\n').trimEnd();
}

function parseNeeds(jobBlock: string): string[] {
  const rawNeeds = parseScalarMatch(jobBlock, /^ {4}needs:\s*(.+)$/m);
  if (rawNeeds === undefined) {
    return [];
  }

  if (rawNeeds.startsWith('[') && rawNeeds.endsWith(']')) {
    return rawNeeds
      .slice(1, -1)
      .split(',')
      .map((entry) => parseScalar(entry))
      .filter((entry) => entry.length > 0);
  }

  return [rawNeeds];
}

function parseTopLevelMap(raw: string, key: string): Map<string, string> {
  const section = extractTopLevelSection(raw, key);
  if (section === undefined) {
    return new Map();
  }
  return parseKeyValueBlock(section, 2);
}

function parseNestedMap(
  raw: string,
  headerIndent: number,
  key: string,
  childIndent: number,
): Map<string, string> {
  const header = new RegExp(`^ {${headerIndent}}${escapeRegExp(key)}:\\s*$`, 'm').exec(raw);
  if (header?.index === undefined) {
    return new Map();
  }

  const blockStart = header.index + header[0].length;
  const lines = raw.slice(blockStart).split('\n');
  const nestedLines: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      nestedLines.push(line);
      continue;
    }

    if (leadingSpaces(line) <= headerIndent) {
      break;
    }
    nestedLines.push(line);
  }

  return parseKeyValueBlock(nestedLines.join('\n'), childIndent);
}

function parseKeyValueBlock(block: string, indent: number): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):\\s*(.*)$`, 'gm');

  for (const match of block.matchAll(pattern)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      values.set(key, parseScalar(value));
    }
  }

  return values;
}

function extractTopLevelSection(raw: string, key: string): string | undefined {
  const header = new RegExp(`^${escapeRegExp(key)}:\\s*$`, 'm').exec(raw);
  if (header?.index === undefined) {
    return undefined;
  }

  const blockStart = header.index + header[0].length;
  const rest = raw.slice(blockStart);
  const nextTopLevel = /^\S[^:\n]*:\s*$/m.exec(rest);
  return rest.slice(0, nextTopLevel?.index ?? rest.length);
}

function parseScalarMatch(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return parseScalar(match[1]);
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function leadingSpaces(value: string): number {
  return value.match(/^ */)?.[0].length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
