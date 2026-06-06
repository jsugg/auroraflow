import {
  SelfHealingActionType,
  SelfHealingConfig,
  SelfHealingMode,
  SelfHealingPromotionMode,
  SelfHealingRegistryMode,
  SelfHealingSatConfig,
} from './types';

export const DEFAULT_SELF_HEAL_MIN_CONFIDENCE = 0.92;
export const DEFAULT_SELF_HEAL_MAX_DOM_NODES = 500;
export const DEFAULT_SELF_HEAL_MAX_CANDIDATES = 10;
export const DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH = 120;

const HARD_MAX_SELF_HEAL_DOM_NODES = 5_000;
const HARD_MAX_SELF_HEAL_CANDIDATES = 50;
const HARD_MAX_SELF_HEAL_TEXT_LENGTH = 500;

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

function parseSelfHealingMode(rawMode: string | undefined): SelfHealingMode {
  if (!rawMode) {
    return 'off';
  }

  const normalizedMode = rawMode.trim().toLowerCase();
  if (SUPPORTED_SELF_HEAL_MODES.has(normalizedMode as SelfHealingMode)) {
    return normalizedMode as SelfHealingMode;
  }
  return 'off';
}

function parseMinConfidence(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_SELF_HEAL_MIN_CONFIDENCE;
  }

  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 1) {
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

function parseBoolean(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (!rawValue) {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }
  return defaultValue;
}

function parseBoundedPositiveInteger({
  rawValue,
  defaultValue,
  hardMaximum,
}: {
  rawValue: string | undefined;
  defaultValue: number;
  hardMaximum: number;
}): number {
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return defaultValue;
  }
  return Math.min(parsedValue, hardMaximum);
}

function parseAllowedActions(rawValue: string | undefined): SelfHealingActionType[] {
  const normalized = parseDelimitedList(rawValue);
  if (normalized.length === 0) {
    return [...DEFAULT_SELF_HEAL_ALLOWED_ACTIONS];
  }

  const allowedActions = normalized.filter((action): action is SelfHealingActionType =>
    SUPPORTED_SELF_HEAL_ACTIONS.has(action as SelfHealingActionType),
  );
  if (allowedActions.length === 0) {
    return [...DEFAULT_SELF_HEAL_ALLOWED_ACTIONS];
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

function parseRegistryMode(rawValue: string | undefined): SelfHealingRegistryMode {
  if (!rawValue) {
    return 'read';
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (SUPPORTED_REGISTRY_MODES.has(normalizedValue as SelfHealingRegistryMode)) {
    return normalizedValue as SelfHealingRegistryMode;
  }
  return 'read';
}

function parsePromotionMode(rawValue: string | undefined): SelfHealingPromotionMode {
  if (!rawValue) {
    return 'manual';
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (SUPPORTED_PROMOTION_MODES.has(normalizedValue as SelfHealingPromotionMode)) {
    return normalizedValue as SelfHealingPromotionMode;
  }
  return 'manual';
}

function resolveSatConfig(
  mode: SelfHealingMode,
  env: Readonly<Record<string, string | undefined>>,
): SelfHealingSatConfig {
  const defaultEnabled = mode !== 'off';
  const enabled = parseBoolean(env.SELF_HEAL_SAT_ENABLED, defaultEnabled);

  return {
    enabled,
    captureDom: enabled ? parseBoolean(env.SELF_HEAL_SAT_CAPTURE_DOM, defaultEnabled) : false,
    maxDomNodes: parseBoundedPositiveInteger({
      rawValue: env.SELF_HEAL_MAX_DOM_NODES,
      defaultValue: DEFAULT_SELF_HEAL_MAX_DOM_NODES,
      hardMaximum: HARD_MAX_SELF_HEAL_DOM_NODES,
    }),
    maxCandidates: parseBoundedPositiveInteger({
      rawValue: env.SELF_HEAL_MAX_CANDIDATES,
      defaultValue: DEFAULT_SELF_HEAL_MAX_CANDIDATES,
      hardMaximum: HARD_MAX_SELF_HEAL_CANDIDATES,
    }),
    maxTextLength: parseBoundedPositiveInteger({
      rawValue: env.SELF_HEAL_MAX_TEXT_LENGTH,
      defaultValue: DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
      hardMaximum: HARD_MAX_SELF_HEAL_TEXT_LENGTH,
    }),
    allowedAttributes: parseAllowedAttributes(env.SELF_HEAL_ALLOWED_ATTRIBUTES),
    registryMode: parseRegistryMode(env.SELF_HEAL_REGISTRY_MODE),
    promotionMode: parsePromotionMode(env.SELF_HEAL_PROMOTION_MODE),
  };
}

export function resolveSelfHealingConfig(
  env: Readonly<Record<string, string | undefined>>,
): SelfHealingConfig {
  const mode = parseSelfHealingMode(env.SELF_HEAL_MODE);

  return {
    mode,
    minConfidence: parseMinConfidence(env.SELF_HEAL_MIN_CONFIDENCE),
    safetyPolicy: {
      allowedActions: parseAllowedActions(env.SELF_HEAL_ALLOWED_ACTIONS),
      allowedDomains: parseAllowedDomains(env.SELF_HEAL_ALLOWED_DOMAINS),
    },
    sat: resolveSatConfig(mode, env),
  };
}
