import { SelfHealingConfig, SelfHealingMode } from './types';

export const DEFAULT_SELF_HEAL_MIN_CONFIDENCE = 0.92;

const SUPPORTED_SELF_HEAL_MODES: ReadonlySet<SelfHealingMode> = new Set([
  'off',
  'suggest',
  'guarded',
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

export function resolveSelfHealingConfig(
  env: Readonly<Record<string, string | undefined>>,
): SelfHealingConfig {
  return {
    mode: parseSelfHealingMode(env.SELF_HEAL_MODE),
    minConfidence: parseMinConfidence(env.SELF_HEAL_MIN_CONFIDENCE),
  };
}
