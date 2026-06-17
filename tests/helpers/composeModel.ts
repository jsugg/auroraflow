import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ComposeHealthcheck {
  readonly test: readonly string[];
  readonly interval?: string;
  readonly timeout?: string;
  readonly retries?: string;
  readonly startPeriod?: string;
}

export interface ComposeService {
  readonly name: string;
  readonly image?: string;
  readonly restart?: string;
  readonly command: readonly string[];
  readonly ports: readonly string[];
  readonly volumes: readonly string[];
  readonly environment: ReadonlyMap<string, string>;
  readonly healthcheck?: ComposeHealthcheck;
  readonly raw: string;
}

export interface ComposeModel {
  readonly raw: string;
  readonly services: ReadonlyMap<string, ComposeService>;
  readonly volumes: ReadonlySet<string>;
}

/** Parses the Docker Compose subset used by repository contract tests. */
export function readComposeModel(relativePath: string): ComposeModel {
  const raw = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  return {
    raw,
    services: parseServices(raw),
    volumes: parseTopLevelKeys(raw, 'volumes'),
  };
}

export function getComposeService(compose: ComposeModel, serviceName: string): ComposeService {
  const service = compose.services.get(serviceName);
  if (service === undefined) {
    throw new Error(`Docker Compose service not found: ${serviceName}`);
  }
  return service;
}

function parseServices(raw: string): Map<string, ComposeService> {
  const servicesSection = extractTopLevelSection(raw, 'services');
  if (servicesSection === undefined) {
    return new Map();
  }

  const services = new Map<string, ComposeService>();
  const serviceHeaders = [...servicesSection.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  for (let index = 0; index < serviceHeaders.length; index += 1) {
    const header = serviceHeaders[index];
    const serviceName = header[1];
    if (serviceName === undefined) {
      continue;
    }

    const start = header.index ?? 0;
    const nextHeader = serviceHeaders[index + 1];
    const end = nextHeader?.index ?? servicesSection.length;
    const serviceBlock = servicesSection.slice(start, end);
    services.set(serviceName, {
      name: serviceName,
      image: parseScalarMatch(serviceBlock, /^ {4}image:\s*(.+)$/m),
      restart: parseScalarMatch(serviceBlock, /^ {4}restart:\s*(.+)$/m),
      command: parseListOrInlineValue(serviceBlock, 4, 'command', 6),
      ports: parseListOrInlineValue(serviceBlock, 4, 'ports', 6),
      volumes: parseListOrInlineValue(serviceBlock, 4, 'volumes', 6),
      environment: parseNestedMap(serviceBlock, 4, 'environment', 6),
      healthcheck: parseHealthcheck(serviceBlock),
      raw: serviceBlock,
    });
  }

  return services;
}

function parseHealthcheck(serviceBlock: string): ComposeHealthcheck | undefined {
  const healthcheckBlock = extractNestedBlock(serviceBlock, 4, 'healthcheck');
  if (healthcheckBlock === undefined) {
    return undefined;
  }

  return {
    test: parseListOrInlineValue(healthcheckBlock, 6, 'test', 8),
    interval: parseScalarMatch(healthcheckBlock, /^ {6}interval:\s*(.+)$/m),
    timeout: parseScalarMatch(healthcheckBlock, /^ {6}timeout:\s*(.+)$/m),
    retries: parseScalarMatch(healthcheckBlock, /^ {6}retries:\s*(.+)$/m),
    startPeriod: parseScalarMatch(healthcheckBlock, /^ {6}start_period:\s*(.+)$/m),
  };
}

function parseTopLevelKeys(raw: string, key: string): Set<string> {
  const section = extractTopLevelSection(raw, key);
  if (section === undefined) {
    return new Set();
  }

  const keys = new Set<string>();
  for (const match of section.matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)) {
    if (match[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function parseNestedMap(
  raw: string,
  headerIndent: number,
  key: string,
  childIndent: number,
): Map<string, string> {
  const block = extractNestedBlock(raw, headerIndent, key);
  if (block === undefined) {
    return new Map();
  }

  const values = new Map<string, string>();
  const pattern = new RegExp(`^ {${childIndent}}([A-Za-z0-9_.-]+):\\s*(.*)$`, 'gm');
  for (const match of block.matchAll(pattern)) {
    const childKey = match[1];
    const value = match[2];
    if (childKey !== undefined && value !== undefined) {
      values.set(childKey, parseScalar(value));
    }
  }
  return values;
}

function parseListOrInlineValue(
  raw: string,
  headerIndent: number,
  key: string,
  childIndent: number,
): string[] {
  const inlineValue = parseScalarMatch(
    raw,
    new RegExp(`^ {${headerIndent}}${escapeRegExp(key)}:\\s*(\\[.+\\])$`, 'm'),
  );
  if (inlineValue !== undefined) {
    return parseInlineList(inlineValue);
  }

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

function parseScalarMatch(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return parseScalar(match[1]);
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

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((entry) => parseScalar(entry))
    .filter((entry) => entry.length > 0);
}

function leadingSpaces(value: string): number {
  return value.match(/^ */)?.[0].length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
