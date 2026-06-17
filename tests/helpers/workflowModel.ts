import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface WorkflowStep {
  readonly name: string;
  readonly id?: string;
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
  readonly timeoutMinutes?: number;
  readonly permissions: ReadonlyMap<string, string>;
  readonly env: ReadonlyMap<string, string>;
  readonly outputs: ReadonlyMap<string, string>;
  readonly strategy?: WorkflowStrategy;
  readonly steps: readonly WorkflowStep[];
  readonly raw: string;
}

export interface WorkflowStrategy {
  readonly failFast?: string;
  readonly maxParallel?: number;
  readonly matrix: ReadonlyMap<string, readonly string[]>;
  readonly include: readonly ReadonlyMap<string, string>[];
}

export interface WorkflowModel {
  readonly raw: string;
  readonly triggers: ReadonlySet<string>;
  readonly concurrency: ReadonlyMap<string, string>;
  readonly permissions: ReadonlyMap<string, string>;
  readonly env: ReadonlyMap<string, string>;
  readonly jobs: ReadonlyMap<string, WorkflowJob>;
}

/** Parses the GitHub Actions subset used by repository workflow contracts. */
export function readWorkflowModel(relativePath: string): WorkflowModel {
  const raw = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  return {
    raw,
    triggers: parseTriggers(raw),
    concurrency: parseTopLevelMap(raw, 'concurrency'),
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

export function getWorkflowStepById(job: WorkflowJob, stepId: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new Error(`Workflow step id not found in ${job.id}: ${stepId}`);
  }
  return step;
}

export function getWorkflowActionReferences(workflow: WorkflowModel): readonly string[] {
  const references: string[] = [];
  for (const job of workflow.jobs.values()) {
    if (job.uses !== undefined) {
      references.push(job.uses);
    }
    for (const step of job.steps) {
      if (step.uses !== undefined) {
        references.push(step.uses);
      }
    }
  }
  return references;
}

export function getWorkflowMatrixValues(job: WorkflowJob, key: string): readonly string[] {
  const values = job.strategy?.matrix.get(key);
  if (values === undefined) {
    throw new Error(`Workflow matrix key not found in ${job.id}: ${key}`);
  }
  return values;
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
      timeoutMinutes: parseNumberMatch(jobBlock, /^ {4}timeout-minutes:\s*(\d+)$/m),
      permissions: parseNestedMap(jobBlock, 4, 'permissions', 6),
      env: parseNestedMap(jobBlock, 4, 'env', 6),
      outputs: parseNestedMap(jobBlock, 4, 'outputs', 6),
      strategy: parseStrategy(jobBlock),
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
      id: parseScalarMatch(stepBlock, /^ {8}id:\s*(.+)$/m),
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
    return parseListUnder(jobBlock, 4, 'needs', 6);
  }

  if (rawNeeds.startsWith('[') && rawNeeds.endsWith(']')) {
    return parseInlineList(rawNeeds);
  }

  return [rawNeeds];
}

function parseTriggers(raw: string): Set<string> {
  const section = extractTopLevelSection(raw, 'on');
  if (section === undefined) {
    return new Set();
  }

  const triggers = new Set<string>();
  for (const match of section.matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)) {
    if (match[1] !== undefined) {
      triggers.add(match[1]);
    }
  }
  return triggers;
}

function parseStrategy(jobBlock: string): WorkflowStrategy | undefined {
  const strategyBlock = extractNestedBlock(jobBlock, 4, 'strategy');
  if (strategyBlock === undefined) {
    return undefined;
  }

  const matrixBlock = extractNestedBlock(strategyBlock, 6, 'matrix') ?? '';
  return {
    failFast: parseScalarMatch(strategyBlock, /^ {6}fail-fast:\s*(.+)$/m),
    maxParallel: parseNumberMatch(strategyBlock, /^ {6}max-parallel:\s*(\d+)$/m),
    matrix: parseMatrix(matrixBlock),
    include: parseMatrixInclude(matrixBlock),
  };
}

function parseMatrix(matrixBlock: string): Map<string, readonly string[]> {
  const matrix = new Map<string, readonly string[]>();
  const matrixHeaders = [...matrixBlock.matchAll(/^ {8}([A-Za-z0-9_-]+):\s*(.*)$/gm)];

  for (const header of matrixHeaders) {
    const key = header[1];
    const value = header[2];
    if (key === undefined || value === undefined || key === 'include') {
      continue;
    }

    const trimmedValue = value.trim();
    if (trimmedValue.length > 0) {
      matrix.set(key, parseInlineListOrScalar(trimmedValue));
      continue;
    }
    matrix.set(key, parseListUnder(matrixBlock, 8, key, 10));
  }

  return matrix;
}

function parseMatrixInclude(matrixBlock: string): ReadonlyMap<string, string>[] {
  const includeBlock = extractNestedBlock(matrixBlock, 8, 'include');
  if (includeBlock === undefined) {
    return [];
  }

  const itemHeaders = [...includeBlock.matchAll(/^ {10}-\s+([A-Za-z0-9_-]+):\s*(.*)$/gm)];
  const items: ReadonlyMap<string, string>[] = [];

  for (let index = 0; index < itemHeaders.length; index += 1) {
    const header = itemHeaders[index];
    const firstKey = header[1];
    const firstValue = header[2];
    if (firstKey === undefined || firstValue === undefined) {
      continue;
    }

    const start = header.index ?? 0;
    const nextHeader = itemHeaders[index + 1];
    const end = nextHeader?.index ?? includeBlock.length;
    const itemBlock = includeBlock.slice(start, end);
    const values = new Map<string, string>([[firstKey, parseScalar(firstValue)]]);
    for (const match of itemBlock.matchAll(/^ {12}([A-Za-z0-9_-]+):\s*(.*)$/gm)) {
      const key = match[1];
      const value = match[2];
      if (key !== undefined && value !== undefined) {
        values.set(key, parseScalar(value));
      }
    }
    items.push(values);
  }

  return items;
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
  const lines = block.split('\n');
  const pattern = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):\\s*(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index] ?? '');
    if (match === null) {
      continue;
    }
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      if (['|', '>'].includes(value.trim())) {
        const blockLines: string[] = [];
        for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
          const line = lines[childIndex] ?? '';
          if (line.trim().length > 0 && leadingSpaces(line) <= indent) {
            break;
          }
          blockLines.push(
            line.startsWith(' '.repeat(indent + 2)) ? line.slice(indent + 2) : line.trimStart(),
          );
          index = childIndex;
        }
        values.set(key, blockLines.join('\n').trimEnd());
      } else {
        values.set(key, parseScalar(value));
      }
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
  if (match?.[1] === undefined || match[0].includes('\n')) {
    return undefined;
  }
  return parseScalar(match[1]);
}

function parseNumberMatch(source: string, pattern: RegExp): number | undefined {
  const value = parseScalarMatch(source, pattern);
  if (value === undefined) {
    return undefined;
  }
  return Number(value);
}

function parseScalar(value: string): string {
  let trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.search(/\s#/);
  if (commentIndex !== -1) {
    trimmed = trimmed.slice(0, commentIndex).trimEnd();
  }
  return trimmed;
}

function parseInlineListOrScalar(value: string): readonly string[] {
  return value.startsWith('[') && value.endsWith(']')
    ? parseInlineList(value)
    : [parseScalar(value)];
}

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((entry) => parseScalar(entry))
    .filter((entry) => entry.length > 0);
}

function parseListUnder(
  raw: string,
  headerIndent: number,
  key: string,
  childIndent: number,
): string[] {
  const block = extractNestedBlock(raw, headerIndent, key);
  if (block === undefined) {
    return [];
  }

  const values: string[] = [];
  const pattern = new RegExp(`^ {${childIndent}}-\\s*(.+)$`, 'gm');
  for (const match of block.matchAll(pattern)) {
    if (match[1] !== undefined) {
      values.push(parseScalar(match[1]));
    }
  }
  return values;
}

function extractNestedBlock(raw: string, headerIndent: number, key: string): string | undefined {
  const header = new RegExp(`^ {${headerIndent}}${escapeRegExp(key)}:\\s*$`, 'm').exec(raw);
  if (header?.index === undefined) {
    return undefined;
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
  return nestedLines.join('\n');
}

function leadingSpaces(value: string): number {
  return value.match(/^ */)?.[0].length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
