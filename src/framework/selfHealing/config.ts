import { SelfHealingActionType, SelfHealingConfig, SelfHealingMode } from './types';

export const DEFAULT_SELF_HEAL_MIN_CONFIDENCE = 0.92;

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

export function resolveSelfHealingConfig(
  env: Readonly<Record<string, string | undefined>>,
): SelfHealingConfig {
  return {
    mode: parseSelfHealingMode(env.SELF_HEAL_MODE),
    minConfidence: parseMinConfidence(env.SELF_HEAL_MIN_CONFIDENCE),
    safetyPolicy: {
      allowedActions: parseAllowedActions(env.SELF_HEAL_ALLOWED_ACTIONS),
      allowedDomains: parseAllowedDomains(env.SELF_HEAL_ALLOWED_DOMAINS),
    },
  };
}
