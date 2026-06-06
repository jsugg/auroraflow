import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { normalizeOptionalIdentifier, resolveCorrelationIdentifiers } from './correlation';

export type ObservabilityEnvironment = 'local' | 'ci' | 'staging' | 'production';

export interface TelemetryRuntimeConfig {
  enabled: boolean;
  strict: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: ObservabilityEnvironment;
  exportRawSelectors: boolean;
  metricExportIntervalMs: number;
  shutdownTimeoutMs: number;
  resourceAttributes: Readonly<Record<string, string>>;
}

export class TelemetryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryConfigError';
  }
}

const DEFAULT_SERVICE_NAME = 'auroraflow';
const DEFAULT_SERVICE_VERSION = '1.0.0';
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;
const MAX_ATTRIBUTE_VALUE_LENGTH = 256;
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;

const DEPLOYMENT_ENVIRONMENT_ATTRIBUTE = 'deployment.environment';

export const RESOURCE_ATTRIBUTE_NAMES = Object.freeze([
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  DEPLOYMENT_ENVIRONMENT_ATTRIBUTE,
  'vcs.repository.url',
  'vcs.branch',
  'vcs.commit.sha',
  'ci.workflow.name',
  'ci.job.name',
  'ci.run.id',
  'auroraflow.run_id',
  'auroraflow.test_id',
  'auroraflow.project',
  'auroraflow.shard',
] as const);

export type ResourceAttributeName = (typeof RESOURCE_ATTRIBUTE_NAMES)[number];

type Environment = Readonly<Record<string, string | undefined>>;

function normalizeOptionalString(rawValue: string | undefined): string | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const normalized = rawValue.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function parseBooleanEnv({
  key,
  value,
  defaultValue,
}: {
  key: string;
  value: string | undefined;
  defaultValue: boolean;
}): boolean {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (normalized === undefined) {
    return defaultValue;
  }
  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }
  throw new TelemetryConfigError(`${key} must be a boolean-like value. Received: ${value}`);
}

function parseIntegerEnv({
  key,
  value,
  defaultValue,
  minimum,
  maximum,
}: {
  key: string;
  value: string | undefined;
  defaultValue: number;
  minimum: number;
  maximum: number;
}): number {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TelemetryConfigError(
      `${key} must be an integer between ${minimum} and ${maximum}. Received: ${value}`,
    );
  }
  return parsed;
}

function normalizeIdentifier({
  key,
  value,
  defaultValue,
}: {
  key: string;
  value: string | undefined;
  defaultValue: string;
}): string {
  const normalized = normalizeOptionalString(value) ?? defaultValue;
  if (normalized.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(normalized)) {
    throw new TelemetryConfigError(
      `${key} must be 1-128 characters and contain only letters, numbers, ., _, :, /, or -.`,
    );
  }
  return normalized;
}

function resolveEnvironment(env: Environment): ObservabilityEnvironment {
  const rawEnvironment = normalizeOptionalString(env.AURORAFLOW_OBSERVABILITY_ENVIRONMENT);
  if (rawEnvironment !== undefined) {
    const normalized = rawEnvironment.toLowerCase();
    if (
      normalized === 'local' ||
      normalized === 'ci' ||
      normalized === 'staging' ||
      normalized === 'production'
    ) {
      return normalized;
    }
    throw new TelemetryConfigError(
      'AURORAFLOW_OBSERVABILITY_ENVIRONMENT must be local, ci, staging, or production.',
    );
  }
  if (parseBooleanEnv({ key: 'CI', value: env.CI, defaultValue: false })) {
    return 'ci';
  }
  if (normalizeOptionalString(env.NODE_ENV)?.toLowerCase() === 'production') {
    return 'production';
  }
  return 'local';
}

function validateOtlpEndpoint(env: Environment): void {
  const endpoint =
    normalizeOptionalString(env.OTEL_EXPORTER_OTLP_ENDPOINT) ??
    normalizeOptionalString(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) ??
    normalizeOptionalString(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
  if (endpoint === undefined) {
    return;
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TelemetryConfigError('OTLP endpoints must use http:// or https://.');
    }
  } catch (error: unknown) {
    if (error instanceof TelemetryConfigError) {
      throw error;
    }
    throw new TelemetryConfigError('OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL.');
  }
}

function parseResourceAttributes(rawAttributes: string | undefined): Record<string, string> {
  const normalized = normalizeOptionalString(rawAttributes);
  if (normalized === undefined) {
    return {};
  }
  if (normalized.length > 2_048) {
    throw new TelemetryConfigError('OTEL_RESOURCE_ATTRIBUTES must be 2048 characters or less.');
  }

  const attributes: Record<string, string> = {};
  for (const rawPair of normalized.split(',')) {
    const [rawKey, ...rawValueParts] = rawPair.split('=');
    const key = rawKey?.trim();
    const value = rawValueParts.join('=').trim();
    if (!key || !value) {
      throw new TelemetryConfigError(
        'OTEL_RESOURCE_ATTRIBUTES entries must be comma-separated key=value pairs.',
      );
    }
    if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
      throw new TelemetryConfigError(`Invalid OTEL_RESOURCE_ATTRIBUTES key: ${key}`);
    }
    attributes[key] = value.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  return attributes;
}

function addAttribute(
  attributes: Record<string, string>,
  key: ResourceAttributeName,
  value: string | undefined,
): void {
  const normalized = normalizeOptionalString(value);
  if (normalized !== undefined) {
    attributes[key] = normalized.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
}

function resolveRepositoryUrl(env: Environment): string | undefined {
  const explicitRepositoryUrl = normalizeOptionalString(env.AURORAFLOW_REPOSITORY_URL);
  if (explicitRepositoryUrl !== undefined) {
    return explicitRepositoryUrl;
  }
  const repository = normalizeOptionalString(env.GITHUB_REPOSITORY);
  if (repository === undefined) {
    return undefined;
  }
  const serverUrl = normalizeOptionalString(env.GITHUB_SERVER_URL) ?? 'https://github.com';
  return `${serverUrl.replace(/\/+$/g, '')}/${repository}`;
}

export function resolveTelemetryConfig(env: Environment = process.env): TelemetryRuntimeConfig {
  validateOtlpEndpoint(env);

  const parsedResourceAttributes = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  const serviceName = normalizeIdentifier({
    key: 'AURORAFLOW_OBSERVABILITY_SERVICE_NAME',
    value:
      env.AURORAFLOW_OBSERVABILITY_SERVICE_NAME ??
      env.OTEL_SERVICE_NAME ??
      parsedResourceAttributes[ATTR_SERVICE_NAME],
    defaultValue: DEFAULT_SERVICE_NAME,
  });
  const serviceVersion = normalizeIdentifier({
    key: 'AURORAFLOW_OBSERVABILITY_SERVICE_VERSION',
    value:
      env.AURORAFLOW_OBSERVABILITY_SERVICE_VERSION ??
      parsedResourceAttributes[ATTR_SERVICE_VERSION],
    defaultValue: DEFAULT_SERVICE_VERSION,
  });
  const environment = resolveEnvironment(env);
  const correlation = resolveCorrelationIdentifiers({ env });

  const resourceAttributes: Record<string, string> = { ...parsedResourceAttributes };
  addAttribute(resourceAttributes, ATTR_SERVICE_NAME, serviceName);
  addAttribute(resourceAttributes, ATTR_SERVICE_VERSION, serviceVersion);
  addAttribute(resourceAttributes, DEPLOYMENT_ENVIRONMENT_ATTRIBUTE, environment);
  addAttribute(resourceAttributes, 'vcs.repository.url', resolveRepositoryUrl(env));
  addAttribute(resourceAttributes, 'vcs.branch', env.GITHUB_HEAD_REF ?? env.GITHUB_REF_NAME);
  addAttribute(resourceAttributes, 'vcs.commit.sha', env.GITHUB_SHA);
  addAttribute(resourceAttributes, 'ci.workflow.name', env.GITHUB_WORKFLOW);
  addAttribute(resourceAttributes, 'ci.job.name', env.GITHUB_JOB);
  addAttribute(resourceAttributes, 'ci.run.id', env.GITHUB_RUN_ID);
  addAttribute(resourceAttributes, 'auroraflow.run_id', correlation.runId);
  addAttribute(resourceAttributes, 'auroraflow.test_id', correlation.testId);
  addAttribute(
    resourceAttributes,
    'auroraflow.project',
    normalizeOptionalIdentifier(env.AURORAFLOW_PROJECT),
  );
  addAttribute(
    resourceAttributes,
    'auroraflow.shard',
    normalizeOptionalIdentifier(env.AURORAFLOW_SHARD),
  );

  return {
    enabled: parseBooleanEnv({
      key: 'AURORAFLOW_OBSERVABILITY_ENABLED',
      value: env.AURORAFLOW_OBSERVABILITY_ENABLED,
      defaultValue: false,
    }),
    strict: parseBooleanEnv({
      key: 'AURORAFLOW_OBSERVABILITY_STRICT',
      value: env.AURORAFLOW_OBSERVABILITY_STRICT,
      defaultValue: false,
    }),
    serviceName,
    serviceVersion,
    environment,
    exportRawSelectors: parseBooleanEnv({
      key: 'AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS',
      value: env.AURORAFLOW_OBSERVABILITY_EXPORT_RAW_SELECTORS,
      defaultValue: false,
    }),
    metricExportIntervalMs: parseIntegerEnv({
      key: 'AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS',
      value: env.AURORAFLOW_OBSERVABILITY_METRIC_EXPORT_INTERVAL_MS,
      defaultValue: DEFAULT_METRIC_EXPORT_INTERVAL_MS,
      minimum: 1_000,
      maximum: 300_000,
    }),
    shutdownTimeoutMs: parseIntegerEnv({
      key: 'AURORAFLOW_OBSERVABILITY_SHUTDOWN_TIMEOUT_MS',
      value: env.AURORAFLOW_OBSERVABILITY_SHUTDOWN_TIMEOUT_MS,
      defaultValue: DEFAULT_SHUTDOWN_TIMEOUT_MS,
      minimum: 100,
      maximum: 120_000,
    }),
    resourceAttributes,
  };
}
