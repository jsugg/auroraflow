import { createChildLogger, type Logger } from '../../utils/logger';
import {
  SelfHealingActionType,
  SelfHealingConfig,
  SelfHealingMode,
  SelfHealingPromotionMode,
  SelfHealingRegistryMode,
  SelfHealingRunBudgetConfig,
  SelfHealingRunBudgetMode,
  SelfHealingSatConfig,
} from './types';

export const DEFAULT_SELF_HEAL_MIN_CONFIDENCE = 0.92;
export const DEFAULT_SELF_HEAL_MAX_DOM_NODES = 500;
export const DEFAULT_SELF_HEAL_MAX_CANDIDATES = 10;
export const DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH = 120;
export const DEFAULT_SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS = 25;
export const DEFAULT_SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS = 50;

export const SELF_HEAL_CONFIG_STRICT_ENV = 'AURORAFLOW_CONFIG_STRICT';

const HARD_MAX_SELF_HEAL_DOM_NODES = 5_000;
const HARD_MAX_SELF_HEAL_CANDIDATES = 50;
const HARD_MAX_SELF_HEAL_TEXT_LENGTH = 500;
const HARD_MAX_SELF_HEAL_RUN_BUDGET_EVENTS = 10_000;

const SUPPORTED_SELF_HEAL_MODES: ReadonlySet<SelfHealingMode> = new Set([
  'off',
  'suggest',
  'guarded',
]);

const DEFAULT_SELF_HEAL_ALLOWED_ACTIONS: SelfHealingActionType[] = [
  'click',
  'type',
  'read',
  'wait',
  'screenshot',
];

const SUPPORTED_SELF_HEAL_ACTIONS: ReadonlySet<SelfHealingActionType> = new Set([
  'navigate',
  'click',
  'type',
  'read',
  'wait',
  'screenshot',
  'close',
  'unknown',
]);

const DEFAULT_SELF_HEAL_ALLOWED_ATTRIBUTES = Object.freeze([
  'data-testid',
  'data-test',
  'id',
  'name',
  'aria-label',
  'placeholder',
  'title',
  'role',
  'type',
]);

const SUPPORTED_REGISTRY_MODES: ReadonlySet<SelfHealingRegistryMode> = new Set([
  'off',
  'read',
  'write_pending',
]);

const SUPPORTED_PROMOTION_MODES: ReadonlySet<SelfHealingPromotionMode> = new Set([
  'manual',
  'ci_acknowledged',
]);

const SUPPORTED_RUN_BUDGET_MODES: ReadonlySet<SelfHealingRunBudgetMode> = new Set([
  'warning_only',
  'enforce',
]);

const TRUE_BOOLEAN_TOKENS = ['1', 'true', 'yes', 'on'];
const FALSE_BOOLEAN_TOKENS = ['0', 'false', 'no', 'off'];

export type SelfHealingConfigDiagnosticCode =
  | 'invalid_enum'
  | 'invalid_boolean'
  | 'invalid_number'
  | 'out_of_range'
  | 'clamped'
  | 'unsupported_list_values';

/**
 * One observable problem with a `SELF_HEAL_*` environment value.
 *
 * Messages never echo raw environment values so diagnostics stay safe to log
 * even when an unrelated secret is accidentally placed in a self-healing variable.
 */
export interface SelfHealingConfigDiagnostic {
  envVar: string;
  code: SelfHealingConfigDiagnosticCode;
  message: string;
  applied: string;
}

export interface SelfHealingConfigResolution {
  config: SelfHealingConfig;
  diagnostics: SelfHealingConfigDiagnostic[];
  strict: boolean;
}

export interface ResolveSelfHealingConfigOptions {
  /** Overrides the `AURORAFLOW_CONFIG_STRICT` environment flag. */
  strict?: boolean;
  /** Receives one warning per diagnostic when not in strict mode. */
  logger?: Pick<Logger, 'warn'>;
}

export class SelfHealingConfigError extends Error {
  public readonly diagnostics: readonly SelfHealingConfigDiagnostic[];

  constructor(diagnostics: readonly SelfHealingConfigDiagnostic[]) {
    super(
      `Invalid self-healing configuration (${SELF_HEAL_CONFIG_STRICT_ENV}=true): ${diagnostics
        .map((diagnostic) => diagnostic.message)
        .join(' ')}`,
    );
    this.name = 'SelfHealingConfigError';
    this.diagnostics = diagnostics;
  }
}

type DiagnosticSink = (diagnostic: SelfHealingConfigDiagnostic) => void;

function enumDiagnostic({
  envVar,
  supported,
  applied,
}: {
  envVar: string;
  supported: Iterable<string>;
  applied: string;
}): SelfHealingConfigDiagnostic {
  return {
    envVar,
    code: 'invalid_enum',
    message: `${envVar} is invalid; expected one of: ${[...supported].join(', ')}. Using "${applied}".`,
    applied,
  };
}

function parseSelfHealingMode(
  rawMode: string | undefined,
  report: DiagnosticSink,
): SelfHealingMode {
  if (!rawMode) {
    return 'off';
  }

  const normalizedMode = rawMode.trim().toLowerCase();
  if (SUPPORTED_SELF_HEAL_MODES.has(normalizedMode as SelfHealingMode)) {
    return normalizedMode as SelfHealingMode;
  }
  report(
    enumDiagnostic({
      envVar: 'SELF_HEAL_MODE',
      supported: SUPPORTED_SELF_HEAL_MODES,
      applied: 'off',
    }),
  );
  return 'off';
}

function parseMinConfidence(rawValue: string | undefined, report: DiagnosticSink): number {
  if (!rawValue) {
    return DEFAULT_SELF_HEAL_MIN_CONFIDENCE;
  }

  const parsedValue = Number(rawValue.trim());
  if (!Number.isFinite(parsedValue)) {
    report({
      envVar: 'SELF_HEAL_MIN_CONFIDENCE',
      code: 'invalid_number',
      message: `SELF_HEAL_MIN_CONFIDENCE is not a number. Using default ${DEFAULT_SELF_HEAL_MIN_CONFIDENCE}.`,
      applied: String(DEFAULT_SELF_HEAL_MIN_CONFIDENCE),
    });
    return DEFAULT_SELF_HEAL_MIN_CONFIDENCE;
  }
  if (parsedValue < 0 || parsedValue > 1) {
    report({
      envVar: 'SELF_HEAL_MIN_CONFIDENCE',
      code: 'out_of_range',
      message: `SELF_HEAL_MIN_CONFIDENCE must be between 0 and 1. Using default ${DEFAULT_SELF_HEAL_MIN_CONFIDENCE}.`,
      applied: String(DEFAULT_SELF_HEAL_MIN_CONFIDENCE),
    });
    return DEFAULT_SELF_HEAL_MIN_CONFIDENCE;
  }
  return parsedValue;
}

function parseDelimitedList(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return [
    ...new Set(
      rawValue
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function parseBoolean({
  envVar,
  rawValue,
  defaultValue,
  report,
}: {
  envVar: string;
  rawValue: string | undefined;
  defaultValue: boolean;
  report: DiagnosticSink;
}): boolean {
  if (!rawValue) {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (TRUE_BOOLEAN_TOKENS.includes(normalizedValue)) {
    return true;
  }
  if (FALSE_BOOLEAN_TOKENS.includes(normalizedValue)) {
    return false;
  }
  report({
    envVar,
    code: 'invalid_boolean',
    message: `${envVar} is not boolean-like (${[...TRUE_BOOLEAN_TOKENS, ...FALSE_BOOLEAN_TOKENS].join(', ')}). Using default ${defaultValue}.`,
    applied: String(defaultValue),
  });
  return defaultValue;
}

function parseBoundedPositiveInteger({
  envVar,
  rawValue,
  defaultValue,
  hardMaximum,
  report,
}: {
  envVar: string;
  rawValue: string | undefined;
  defaultValue: number;
  hardMaximum: number;
  report: DiagnosticSink;
}): number {
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue.trim());
  if (!Number.isInteger(parsedValue)) {
    report({
      envVar,
      code: 'invalid_number',
      message: `${envVar} is not an integer. Using default ${defaultValue}.`,
      applied: String(defaultValue),
    });
    return defaultValue;
  }
  if (parsedValue < 1) {
    report({
      envVar,
      code: 'out_of_range',
      message: `${envVar} must be at least 1. Using default ${defaultValue}.`,
      applied: String(defaultValue),
    });
    return defaultValue;
  }
  if (parsedValue > hardMaximum) {
    report({
      envVar,
      code: 'clamped',
      message: `${envVar} exceeds the hard maximum ${hardMaximum}. Clamping to ${hardMaximum}.`,
      applied: String(hardMaximum),
    });
    return hardMaximum;
  }
  return parsedValue;
}

function parseBoundedNonNegativeInteger({
  envVar,
  rawValue,
  defaultValue,
  hardMaximum,
  report,
}: {
  envVar: string;
  rawValue: string | undefined;
  defaultValue: number;
  hardMaximum: number;
  report: DiagnosticSink;
}): number {
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue.trim());
  if (!Number.isInteger(parsedValue)) {
    report({
      envVar,
      code: 'invalid_number',
      message: `${envVar} is not an integer. Using default ${defaultValue}.`,
      applied: String(defaultValue),
    });
    return defaultValue;
  }
  if (parsedValue < 0) {
    report({
      envVar,
      code: 'out_of_range',
      message: `${envVar} must be at least 0. Using default ${defaultValue}.`,
      applied: String(defaultValue),
    });
    return defaultValue;
  }
  if (parsedValue > hardMaximum) {
    report({
      envVar,
      code: 'clamped',
      message: `${envVar} exceeds the hard maximum ${hardMaximum}. Clamping to ${hardMaximum}.`,
      applied: String(hardMaximum),
    });
    return hardMaximum;
  }
  return parsedValue;
}

function parseAllowedActions(
  rawValue: string | undefined,
  report: DiagnosticSink,
): SelfHealingActionType[] {
  const normalized = parseDelimitedList(rawValue);
  if (normalized.length === 0) {
    return [...DEFAULT_SELF_HEAL_ALLOWED_ACTIONS];
  }

  const allowedActions = normalized.filter((action): action is SelfHealingActionType =>
    SUPPORTED_SELF_HEAL_ACTIONS.has(action as SelfHealingActionType),
  );
  const unsupportedCount = normalized.length - allowedActions.length;
  if (allowedActions.length === 0) {
    report({
      envVar: 'SELF_HEAL_ALLOWED_ACTIONS',
      code: 'unsupported_list_values',
      message: `SELF_HEAL_ALLOWED_ACTIONS contains no supported action types (${[...SUPPORTED_SELF_HEAL_ACTIONS].join(', ')}). Using the default allow-list.`,
      applied: DEFAULT_SELF_HEAL_ALLOWED_ACTIONS.join(','),
    });
    return [...DEFAULT_SELF_HEAL_ALLOWED_ACTIONS];
  }
  if (unsupportedCount > 0) {
    report({
      envVar: 'SELF_HEAL_ALLOWED_ACTIONS',
      code: 'unsupported_list_values',
      message: `SELF_HEAL_ALLOWED_ACTIONS ignored ${unsupportedCount} unsupported action value(s) (supported: ${[...SUPPORTED_SELF_HEAL_ACTIONS].join(', ')}).`,
      applied: allowedActions.join(','),
    });
  }
  return allowedActions;
}

function parseAllowedDomains(rawValue: string | undefined): string[] {
  return parseDelimitedList(rawValue);
}

function parseAllowedAttributes(rawValue: string | undefined): string[] {
  const normalizedAttributes = parseDelimitedList(rawValue);
  if (normalizedAttributes.length === 0) {
    return [...DEFAULT_SELF_HEAL_ALLOWED_ATTRIBUTES];
  }
  return normalizedAttributes;
}

function parseRegistryMode(
  rawValue: string | undefined,
  report: DiagnosticSink,
): SelfHealingRegistryMode {
  if (!rawValue) {
    return 'read';
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (SUPPORTED_REGISTRY_MODES.has(normalizedValue as SelfHealingRegistryMode)) {
    return normalizedValue as SelfHealingRegistryMode;
  }
  report(
    enumDiagnostic({
      envVar: 'SELF_HEAL_REGISTRY_MODE',
      supported: SUPPORTED_REGISTRY_MODES,
      applied: 'read',
    }),
  );
  return 'read';
}

function parsePromotionMode(
  rawValue: string | undefined,
  report: DiagnosticSink,
): SelfHealingPromotionMode {
  if (!rawValue) {
    return 'manual';
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (SUPPORTED_PROMOTION_MODES.has(normalizedValue as SelfHealingPromotionMode)) {
    return normalizedValue as SelfHealingPromotionMode;
  }
  report(
    enumDiagnostic({
      envVar: 'SELF_HEAL_PROMOTION_MODE',
      supported: SUPPORTED_PROMOTION_MODES,
      applied: 'manual',
    }),
  );
  return 'manual';
}

function parseRunBudgetMode(
  rawValue: string | undefined,
  report: DiagnosticSink,
): SelfHealingRunBudgetMode {
  if (!rawValue) {
    return 'warning_only';
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (SUPPORTED_RUN_BUDGET_MODES.has(normalizedValue as SelfHealingRunBudgetMode)) {
    return normalizedValue as SelfHealingRunBudgetMode;
  }
  report(
    enumDiagnostic({
      envVar: 'SELF_HEAL_RUN_BUDGET_MODE',
      supported: SUPPORTED_RUN_BUDGET_MODES,
      applied: 'warning_only',
    }),
  );
  return 'warning_only';
}

function resolveSatConfig(
  mode: SelfHealingMode,
  env: Readonly<Record<string, string | undefined>>,
  report: DiagnosticSink,
): SelfHealingSatConfig {
  const defaultEnabled = mode !== 'off';
  const enabled = parseBoolean({
    envVar: 'SELF_HEAL_SAT_ENABLED',
    rawValue: env.SELF_HEAL_SAT_ENABLED,
    defaultValue: defaultEnabled,
    report,
  });
  const captureDom = parseBoolean({
    envVar: 'SELF_HEAL_SAT_CAPTURE_DOM',
    rawValue: env.SELF_HEAL_SAT_CAPTURE_DOM,
    defaultValue: defaultEnabled,
    report,
  });

  return {
    enabled,
    captureDom: enabled ? captureDom : false,
    maxDomNodes: parseBoundedPositiveInteger({
      envVar: 'SELF_HEAL_MAX_DOM_NODES',
      rawValue: env.SELF_HEAL_MAX_DOM_NODES,
      defaultValue: DEFAULT_SELF_HEAL_MAX_DOM_NODES,
      hardMaximum: HARD_MAX_SELF_HEAL_DOM_NODES,
      report,
    }),
    maxCandidates: parseBoundedPositiveInteger({
      envVar: 'SELF_HEAL_MAX_CANDIDATES',
      rawValue: env.SELF_HEAL_MAX_CANDIDATES,
      defaultValue: DEFAULT_SELF_HEAL_MAX_CANDIDATES,
      hardMaximum: HARD_MAX_SELF_HEAL_CANDIDATES,
      report,
    }),
    maxTextLength: parseBoundedPositiveInteger({
      envVar: 'SELF_HEAL_MAX_TEXT_LENGTH',
      rawValue: env.SELF_HEAL_MAX_TEXT_LENGTH,
      defaultValue: DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
      hardMaximum: HARD_MAX_SELF_HEAL_TEXT_LENGTH,
      report,
    }),
    allowedAttributes: parseAllowedAttributes(env.SELF_HEAL_ALLOWED_ATTRIBUTES),
    registryMode: parseRegistryMode(env.SELF_HEAL_REGISTRY_MODE, report),
    promotionMode: parsePromotionMode(env.SELF_HEAL_PROMOTION_MODE, report),
  };
}

function resolveRunBudgetConfig(
  env: Readonly<Record<string, string | undefined>>,
  report: DiagnosticSink,
): SelfHealingRunBudgetConfig {
  return {
    mode: parseRunBudgetMode(env.SELF_HEAL_RUN_BUDGET_MODE, report),
    maxHealingAttempts: parseBoundedNonNegativeInteger({
      envVar: 'SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS',
      rawValue: env.SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS,
      defaultValue: DEFAULT_SELF_HEAL_RUN_BUDGET_MAX_HEALING_ATTEMPTS,
      hardMaximum: HARD_MAX_SELF_HEAL_RUN_BUDGET_EVENTS,
      report,
    }),
    maxFailureArtifacts: parseBoundedNonNegativeInteger({
      envVar: 'SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS',
      rawValue: env.SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS,
      defaultValue: DEFAULT_SELF_HEAL_RUN_BUDGET_MAX_FAILURE_ARTIFACTS,
      hardMaximum: HARD_MAX_SELF_HEAL_RUN_BUDGET_EVENTS,
      report,
    }),
  };
}

/**
 * Resolves the effective self-healing configuration plus diagnostics for every
 * invalid `SELF_HEAL_*` value, without logging or throwing.
 */
export function resolveSelfHealingConfigWithDiagnostics(
  env: Readonly<Record<string, string | undefined>>,
): SelfHealingConfigResolution {
  const diagnostics: SelfHealingConfigDiagnostic[] = [];
  const report: DiagnosticSink = (diagnostic) => diagnostics.push(diagnostic);

  const strict = parseBoolean({
    envVar: SELF_HEAL_CONFIG_STRICT_ENV,
    rawValue: env[SELF_HEAL_CONFIG_STRICT_ENV],
    defaultValue: false,
    report,
  });
  const mode = parseSelfHealingMode(env.SELF_HEAL_MODE, report);

  const config: SelfHealingConfig = {
    mode,
    minConfidence: parseMinConfidence(env.SELF_HEAL_MIN_CONFIDENCE, report),
    safetyPolicy: {
      allowedActions: parseAllowedActions(env.SELF_HEAL_ALLOWED_ACTIONS, report),
      allowedDomains: parseAllowedDomains(env.SELF_HEAL_ALLOWED_DOMAINS),
    },
    sat: resolveSatConfig(mode, env, report),
    runBudget: resolveRunBudgetConfig(env, report),
  };

  return { config, diagnostics, strict };
}

/**
 * Returns a plain JSON snapshot of the effective configuration that is safe to
 * log or serialize: it only contains values derived from `SELF_HEAL_*`
 * variables and never credentials such as Redis connection settings.
 */
export function describeEffectiveSelfHealingConfig(
  config: SelfHealingConfig,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

let diagnosticsLogger: Pick<Logger, 'warn'> | undefined;

function defaultDiagnosticsLogger(): Pick<Logger, 'warn'> {
  diagnosticsLogger ??= createChildLogger('SelfHealingConfig');
  return diagnosticsLogger;
}

export function resolveSelfHealingConfig(
  env: Readonly<Record<string, string | undefined>>,
  options: ResolveSelfHealingConfigOptions = {},
): SelfHealingConfig {
  const resolution = resolveSelfHealingConfigWithDiagnostics(env);
  if (resolution.diagnostics.length === 0) {
    return resolution.config;
  }

  if (options.strict ?? resolution.strict) {
    throw new SelfHealingConfigError(resolution.diagnostics);
  }

  const logger = options.logger ?? defaultDiagnosticsLogger();
  for (const diagnostic of resolution.diagnostics) {
    logger.warn(diagnostic.message, {
      envVar: diagnostic.envVar,
      code: diagnostic.code,
      applied: diagnostic.applied,
    });
  }
  return resolution.config;
}
