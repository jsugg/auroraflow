import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  resolveSelfHealingConfig,
} from '../../../../../src/framework/selfHealing/config';

describe('resolveSelfHealingConfig', () => {
  it('returns safe defaults when no environment values are set', () => {
    const config = resolveSelfHealingConfig({});

    expect(config).toEqual({
      mode: 'off',
      minConfidence: DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: [],
      },
    });
  });

  it('accepts supported modes and parses confidence threshold', () => {
    const config = resolveSelfHealingConfig({
      SELF_HEAL_MODE: 'guarded',
      SELF_HEAL_MIN_CONFIDENCE: '0.97',
    });

    expect(config).toEqual({
      mode: 'guarded',
      minConfidence: 0.97,
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: [],
      },
    });
  });

  it('falls back to defaults for invalid mode and invalid confidence', () => {
    const config = resolveSelfHealingConfig({
      SELF_HEAL_MODE: 'anything',
      SELF_HEAL_MIN_CONFIDENCE: '1.5',
    });

    expect(config).toEqual({
      mode: 'off',
      minConfidence: DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
      safetyPolicy: {
        allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
        allowedDomains: [],
      },
    });
  });

  it('parses allow-lists and filters unsupported actions', () => {
    const config = resolveSelfHealingConfig({
      SELF_HEAL_ALLOWED_ACTIONS: ' click , type , unsupported , click ',
      SELF_HEAL_ALLOWED_DOMAINS: 'example.test, sub.example.test , ',
    });

    expect(config.safetyPolicy).toEqual({
      allowedActions: ['click', 'type'],
      allowedDomains: ['example.test', 'sub.example.test'],
    });
  });
});
