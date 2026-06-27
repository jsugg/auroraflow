import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const ARTIFACT_SCHEMA_FILES = {
  domSnapshot: 'dom-snapshot.schema.json',
  flakinessSummary: 'flakiness-summary.schema.json',
  observabilityTrendPoint: 'observability-trend-point.schema.json',
  pendingSelectorPromotion: 'pending-selector-promotion.schema.json',
  selectorCandidateHistory: 'selector-candidate-history.schema.json',
  selectorRegistryRecord: 'selector-registry-record.schema.json',
  selfHealingFailureEvent: 'self-healing-failure-event.schema.json',
  selfHealingGovernanceSummary: 'self-healing-governance-summary.schema.json',
  sloAlertEvaluation: 'slo-alert-evaluation.schema.json',
  sloDashboard: 'slo-dashboard.schema.json',
} as const;

export type ArtifactSchemaFile = (typeof ARTIFACT_SCHEMA_FILES)[keyof typeof ARTIFACT_SCHEMA_FILES];

interface CliOptions {
  artifactsRoot: string;
  schemaDirectory: string;
}

interface GeneratedArtifactInput {
  artifactPath: string;
  schemaFile: ArtifactSchemaFile;
  format: 'json' | 'jsonl';
}

export interface ArtifactSchemaValidator {
  readonly schemaFiles: readonly string[];
  validate(schemaFile: ArtifactSchemaFile, payload: unknown, artifactLabel?: string): void;
}

export interface SchemaValidationSummary {
  schemaCount: number;
  validatedArtifacts: readonly GeneratedArtifactInput[];
}

const DEFAULT_SCHEMA_DIRECTORY = path.join(process.cwd(), 'schemas');
const DEFAULT_ARTIFACTS_ROOT = process.cwd();

const TARGET_SCHEMA_FILES = new Set<string>(Object.values(ARTIFACT_SCHEMA_FILES));

export class ArtifactSchemaConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ArtifactSchemaConfigurationError';
  }
}

export class ArtifactSchemaValidationError extends Error {
  public readonly errors: readonly ErrorObject[];

  public constructor({
    artifactLabel,
    schemaFile,
    errors,
  }: {
    artifactLabel: string;
    schemaFile: string;
    errors: readonly ErrorObject[];
  }) {
    super(`${artifactLabel} does not match ${schemaFile}: ${formatAjvErrors(errors)}`);
    this.name = 'ArtifactSchemaValidationError';
    this.errors = errors;
  }
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    artifactsRoot: DEFAULT_ARTIFACTS_ROOT,
    schemaDirectory: DEFAULT_SCHEMA_DIRECTORY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--schemas-dir') {
      if (!value) {
        throw new ArtifactSchemaConfigurationError('Missing value for --schemas-dir.');
      }
      options.schemaDirectory = path.resolve(value);
      index += 1;
      continue;
    }

    if (argument === '--artifacts-root') {
      if (!value) {
        throw new ArtifactSchemaConfigurationError('Missing value for --artifacts-root.');
      }
      options.artifactsRoot = path.resolve(value);
      index += 1;
      continue;
    }

    throw new ArtifactSchemaConfigurationError(`Unknown argument: ${argument}`);
  }

  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new ArtifactSchemaConfigurationError(`${filePath} must contain a JSON object.`);
  }
  return parsed;
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, 'utf8');
  const values: unknown[] = [];

  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) {
      continue;
    }
    try {
      values.push(JSON.parse(line) as unknown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ArtifactSchemaConfigurationError(
        `${filePath} line ${index + 1} must contain valid JSON: ${message}`,
      );
    }
  }

  return values;
}

async function listSchemaFiles(schemaDirectory: string): Promise<string[]> {
  const entries = await readdir(schemaDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.schema.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function formatAjvErrors(errors: readonly ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return 'unknown schema validation failure.';
  }

  return errors
    .map((error) => {
      const location = error.instancePath.length > 0 ? error.instancePath : '/';
      return `${location} ${error.message ?? 'is invalid'}`;
    })
    .join('; ');
}

export async function createArtifactSchemaValidator(
  schemaDirectory: string = DEFAULT_SCHEMA_DIRECTORY,
): Promise<ArtifactSchemaValidator> {
  const schemaFiles = await listSchemaFiles(schemaDirectory);
  for (const schemaFile of TARGET_SCHEMA_FILES) {
    if (!schemaFiles.includes(schemaFile)) {
      throw new ArtifactSchemaConfigurationError(`Missing artifact schema: ${schemaFile}`);
    }
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);

  const schemaRecords = new Map<string, Record<string, unknown>>();
  for (const schemaFile of schemaFiles) {
    const schema = await readJsonRecord(path.join(schemaDirectory, schemaFile));
    schemaRecords.set(schemaFile, schema);
    ajv.addSchema(schema);
  }

  const validators = new Map<ArtifactSchemaFile, ValidateFunction>();
  for (const schemaFile of TARGET_SCHEMA_FILES) {
    const schema = schemaRecords.get(schemaFile);
    if (!schema) {
      throw new ArtifactSchemaConfigurationError(`Missing artifact schema: ${schemaFile}`);
    }
    const schemaId = schema.$id;
    if (typeof schemaId !== 'string' || schemaId.length === 0) {
      throw new ArtifactSchemaConfigurationError(`${schemaFile} must declare a non-empty $id.`);
    }
    const validator = ajv.getSchema(schemaId);
    if (!validator) {
      throw new ArtifactSchemaConfigurationError(
        `Failed to compile artifact schema: ${schemaFile}`,
      );
    }
    validators.set(schemaFile as ArtifactSchemaFile, validator);
  }

  return {
    schemaFiles,
    validate(schemaFile, payload, artifactLabel = schemaFile): void {
      const validator = validators.get(schemaFile);
      if (!validator) {
        throw new ArtifactSchemaConfigurationError(`No compiled validator for ${schemaFile}.`);
      }
      if (!validator(payload)) {
        throw new ArtifactSchemaValidationError({
          artifactLabel,
          schemaFile,
          errors: validator.errors ?? [],
        });
      }
    },
  };
}

async function listSelfHealingFailureArtifacts(
  artifactsRoot: string,
): Promise<GeneratedArtifactInput[]> {
  const artifactsDirectory = path.join(artifactsRoot, 'test-results', 'self-healing');
  if (!(await fileExists(artifactsDirectory))) {
    return [];
  }

  const entries = await readdir(artifactsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({
      artifactPath: path.join(artifactsDirectory, entry.name),
      schemaFile: ARTIFACT_SCHEMA_FILES.selfHealingFailureEvent,
      format: 'json' as const,
    }))
    .sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));
}

async function listObservabilityTrendArtifacts(
  artifactsRoot: string,
): Promise<GeneratedArtifactInput[]> {
  const directories = [
    path.join(artifactsRoot, 'test-results'),
    path.join(artifactsRoot, '.auroraflow-trends'),
  ];
  const artifacts: GeneratedArtifactInput[] = [];

  for (const directory of directories) {
    if (!(await fileExists(directory))) {
      continue;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    artifacts.push(
      ...entries
        .filter(
          (entry) =>
            entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes('trend'),
        )
        .map((entry) => ({
          artifactPath: path.join(directory, entry.name),
          schemaFile: ARTIFACT_SCHEMA_FILES.observabilityTrendPoint,
          format: 'jsonl' as const,
        })),
    );
  }

  return artifacts.sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));
}

async function collectGeneratedArtifactInputs(
  artifactsRoot: string,
): Promise<GeneratedArtifactInput[]> {
  const artifactInputs: GeneratedArtifactInput[] = [
    ...(await listSelfHealingFailureArtifacts(artifactsRoot)),
    ...(await listObservabilityTrendArtifacts(artifactsRoot)),
  ];

  const defaultArtifacts: readonly GeneratedArtifactInput[] = [
    {
      artifactPath: path.join(artifactsRoot, 'test-results', 'flakiness-summary.json'),
      schemaFile: ARTIFACT_SCHEMA_FILES.flakinessSummary,
      format: 'json',
    },
    {
      artifactPath: path.join(
        artifactsRoot,
        'test-results',
        'self-healing-governance-summary.json',
      ),
      schemaFile: ARTIFACT_SCHEMA_FILES.selfHealingGovernanceSummary,
      format: 'json',
    },
    {
      artifactPath: path.join(artifactsRoot, 'test-results', 'slo-dashboard.json'),
      schemaFile: ARTIFACT_SCHEMA_FILES.sloDashboard,
      format: 'json',
    },
    {
      artifactPath: path.join(artifactsRoot, 'test-results', 'slo-alerts.json'),
      schemaFile: ARTIFACT_SCHEMA_FILES.sloAlertEvaluation,
      format: 'json',
    },
  ];

  for (const artifactInput of defaultArtifacts) {
    if (await fileExists(artifactInput.artifactPath)) {
      artifactInputs.push(artifactInput);
    }
  }

  return artifactInputs;
}

async function validateGeneratedArtifactInput({
  validator,
  artifactInput,
}: {
  validator: ArtifactSchemaValidator;
  artifactInput: GeneratedArtifactInput;
}): Promise<void> {
  if (artifactInput.format === 'jsonl') {
    const values = await readJsonLines(artifactInput.artifactPath);
    for (let index = 0; index < values.length; index += 1) {
      validator.validate(
        artifactInput.schemaFile,
        values[index],
        `${artifactInput.artifactPath} line ${index + 1}`,
      );
    }
    return;
  }

  validator.validate(
    artifactInput.schemaFile,
    await readJsonRecord(artifactInput.artifactPath),
    artifactInput.artifactPath,
  );
}

export async function validateGeneratedArtifacts({
  artifactsRoot = DEFAULT_ARTIFACTS_ROOT,
  schemaDirectory = DEFAULT_SCHEMA_DIRECTORY,
}: Partial<CliOptions> = {}): Promise<SchemaValidationSummary> {
  const validator = await createArtifactSchemaValidator(schemaDirectory);
  const artifactInputs = await collectGeneratedArtifactInputs(artifactsRoot);

  for (const artifactInput of artifactInputs) {
    await validateGeneratedArtifactInput({ validator, artifactInput });
  }

  return {
    schemaCount: validator.schemaFiles.length,
    validatedArtifacts: artifactInputs,
  };
}

async function main(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2));
  const summary = await validateGeneratedArtifacts(options);
  console.log(`Compiled ${summary.schemaCount} JSON Schemas.`);
  console.log(`Validated ${summary.validatedArtifacts.length} generated JSON artifact(s).`);
  if (summary.validatedArtifacts.length === 0) {
    console.log(
      'No generated JSON artifacts found under test-results; schema compile check passed.',
    );
  }
  return 0;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Schema validation failed: ${message}`);
      process.exit(1);
    });
}
