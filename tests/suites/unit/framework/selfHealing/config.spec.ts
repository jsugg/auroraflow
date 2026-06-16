import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SELF_HEAL_MAX_CANDIDATES,
  DEFAULT_SELF_HEAL_MAX_DOM_NODES,
  DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  describeEffectiveSelfHealingConfig,
  resolveSelfHealingConfig,
  resolveSelfHealingConfigWithDiagnostics,
  SELF_HEAL_CONFIG_STRICT_ENV,
  SelfHealingConfigError,
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
      sat: {
        enabled: false,
        captureDom: false,
        maxDomNodes: DEFAULT_SELF_HEAL_MAX_DOM_NODES,
        maxCandidates: DEFAULT_SELF_HEAL_MAX_CANDIDATES,
        maxTextLength: DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
        allowedAttributes: [
          'data-testid',
          'data-test',
          'id',
          'name',
          'aria-label',
          'placeholder',
          'title',
          'role',
          'type',
        ],
        registryMode: 'read',
        promotionMode: 'manual',
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
      sat: {
        enabled: true,
        captureDom: true,
        maxDomNodes: DEFAULT_SELF_HEAL_MAX_DOM_NODES,
        maxCandidates: DEFAULT_SELF_HEAL_MAX_CANDIDATES,
        maxTextLength: DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
        allowedAttributes: [
          'data-testid',
          'data-test',
          'id',
          'name',
          'aria-label',
          'placeholder',
          'title',
          'role',
          'type',
        ],
        registryMode: 'read',
        promotionMode: 'manual',
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
      sat: {
        enabled: false,
        captureDom: false,
        maxDomNodes: DEFAULT_SELF_HEAL_MAX_DOM_NODES,
        maxCandidates: DEFAULT_SELF_HEAL_MAX_CANDIDATES,
        maxTextLength: DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
        allowedAttributes: [
          'data-testid',
          'data-test',
          'id',
          'name',
          'aria-label',
          'placeholder',
          'title',
          'role',
          'type',
        ],
        registryMode: 'read',
        promotionMode: 'manual',
      },
    });
  });

  it('property: rejects undocumented modes and confidence ranges without echoing secret values', () => {
    const invalidModes = ['apply', 'auto', 'GUARDED!', 'suggest-now', 'off;rm -rf /'];
    const invalidConfidences = ['-0.01', '1.01', 'NaN', 'Infinity', 'token-secret-123'];

    for (const mode of invalidModes) {
      for (const minConfidence of invalidConfidences) {
        const resolution = resolveSelfHealingConfigWithDiagnostics({
          SELF_HEAL_MODE: mode,
          SELF_HEAL_MIN_CONFIDENCE: minConfidence,
        });

        expect(resolution.config.mode).toBe('off');
        expect(resolution.config.minConfidence).toBe(DEFAULT_SELF_HEAL_MIN_CONFIDENCE);
        expect(resolution.diagnostics).toHaveLength(2);
        for (const diagnostic of resolution.diagnostics) {
          expect(diagnostic.message).not.toContain(mode);
          expect(diagnostic.message).not.toContain(minConfidence);
          expect(diagnostic.message).not.toContain('token-secret-123');
        }
      }
    }
  });

  it('property: accepts only documented confidence values inside the inclusive range', () => {
    for (let basisPoints = 0; basisPoints <= 100; basisPoints += 1) {
      const minConfidence = (basisPoints / 100).toFixed(2);
      const config = resolveSelfHealingConfig({
        SELF_HEAL_MODE: 'guarded',
        SELF_HEAL_MIN_CONFIDENCE: minConfidence,
      });

      expect(config.mode).toBe('guarded');
      expect(config.minConfidence).toBe(Number(minConfidence));
    }
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

  it('parses SAT controls with bounded numeric policy values', () => {
    const config = resolveSelfHealingConfig({
      SELF_HEAL_MODE: 'suggest',
      SELF_HEAL_MAX_DOM_NODES: '9000',
      SELF_HEAL_MAX_CANDIDATES: '75',
      SELF_HEAL_MAX_TEXT_LENGTH: '900',
      SELF_HEAL_ALLOWED_ATTRIBUTES: 'data-testid,aria-label,data-token',
      SELF_HEAL_REGISTRY_MODE: 'write_pending',
      SELF_HEAL_PROMOTION_MODE: 'ci_acknowledged',
    });

    expect(config.sat).toEqual({
      enabled: true,
      captureDom: true,
      maxDomNodes: 5000,
      maxCandidates: 50,
      maxTextLength: 500,
      allowedAttributes: ['data-testid', 'aria-label', 'data-token'],
      registryMode: 'write_pending',
      promotionMode: 'ci_acknowledged',
    });
  });

  it('allows SAT and DOM capture to be disabled explicitly in suggest mode', () => {
    const config = resolveSelfHealingConfig({
      SELF_HEAL_MODE: 'suggest',
      SELF_HEAL_SAT_ENABLED: 'false',
      SELF_HEAL_SAT_CAPTURE_DOM: 'true',
    });

    expect(config.sat.enabled).toBe(false);
    expect(config.sat.captureDom).toBe(false);
  });

  it('falls back to SAT defaults for invalid numeric and enum controls', () => {
    const config = resolveSelfHealingConfig({
      SELF_HEAL_MODE: 'guarded',
      SELF_HEAL_MAX_DOM_NODES: 'zero',
      SELF_HEAL_MAX_CANDIDATES: '-1',
      SELF_HEAL_MAX_TEXT_LENGTH: '0',
      SELF_HEAL_REGISTRY_MODE: 'invalid',
      SELF_HEAL_PROMOTION_MODE: 'invalid',
    });

    expect(config.sat).toMatchObject({
      enabled: true,
      captureDom: true,
      maxDomNodes: DEFAULT_SELF_HEAL_MAX_DOM_NODES,
      maxCandidates: DEFAULT_SELF_HEAL_MAX_CANDIDATES,
      maxTextLength: DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
      registryMode: 'read',
      promotionMode: 'manual',
    });
  });

  it('warns once per diagnostic through the injected logger by default', () => {
    const warn = vi.fn();

    const config = resolveSelfHealingConfig(
      {
        SELF_HEAL_MODE: 'gaurded',
        SELF_HEAL_MIN_CONFIDENCE: 'high',
      },
      { logger: { warn } },
    );

    expect(config.mode).toBe('off');
    expect(config.minConfidence).toBe(DEFAULT_SELF_HEAL_MIN_CONFIDENCE);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'SELF_HEAL_MODE is invalid; expected one of: off, suggest, guarded. Using "off".',
      { envVar: 'SELF_HEAL_MODE', code: 'invalid_enum', applied: 'off' },
    );
  });

  it('does not warn when every value is valid', () => {
    const warn = vi.fn();

    resolveSelfHealingConfig(
      {
        SELF_HEAL_MODE: ' Guarded ',
        SELF_HEAL_MIN_CONFIDENCE: '0.95',
        SELF_HEAL_SAT_ENABLED: 'true',
        SELF_HEAL_REGISTRY_MODE: 'write_pending',
        SELF_HEAL_PROMOTION_MODE: 'ci_acknowledged',
      },
      { logger: { warn } },
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it('throws SelfHealingConfigError in opt-in strict mode', () => {
    const resolveInvalidStrict = () =>
      resolveSelfHealingConfig({
        [SELF_HEAL_CONFIG_STRICT_ENV]: 'true',
        SELF_HEAL_MODE: 'gaurded',
      });

    expect(resolveInvalidStrict).toThrow(SelfHealingConfigError);
    expect(resolveInvalidStrict).toThrow(
      'Invalid self-healing configuration (AURORAFLOW_CONFIG_STRICT=true): ' +
        'SELF_HEAL_MODE is invalid; expected one of: off, suggest, guarded. Using "off".',
    );
  });

  it('does not throw in strict mode when configuration is valid', () => {
    const config = resolveSelfHealingConfig({
      [SELF_HEAL_CONFIG_STRICT_ENV]: 'true',
      SELF_HEAL_MODE: 'guarded',
    });

    expect(config.mode).toBe('guarded');
  });

  it('honors the strict option override without the environment flag', () => {
    expect(() => resolveSelfHealingConfig({ SELF_HEAL_MODE: 'gaurded' }, { strict: true })).toThrow(
      SelfHealingConfigError,
    );
  });
});

describe('resolveSelfHealingConfigWithDiagnostics', () => {
  it('reports no diagnostics and strict=false for an empty environment', () => {
    const resolution = resolveSelfHealingConfigWithDiagnostics({});

    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.strict).toBe(false);
    expect(resolution.config).toEqual(resolveSelfHealingConfig({}));
  });

  it('reports invalid enums for mode, registry mode, and promotion mode', () => {
    const resolution = resolveSelfHealingConfigWithDiagnostics({
      SELF_HEAL_MODE: 'gaurded',
      SELF_HEAL_REGISTRY_MODE: 'sometimes',
      SELF_HEAL_PROMOTION_MODE: 'auto',
    });

    expect(resolution.diagnostics).toEqual([
      {
        envVar: 'SELF_HEAL_MODE',
        code: 'invalid_enum',
        message: 'SELF_HEAL_MODE is invalid; expected one of: off, suggest, guarded. Using "off".',
        applied: 'off',
      },
      {
        envVar: 'SELF_HEAL_REGISTRY_MODE',
        code: 'invalid_enum',
        message:
          'SELF_HEAL_REGISTRY_MODE is invalid; expected one of: off, read, write_pending. Using "read".',
        applied: 'read',
      },
      {
        envVar: 'SELF_HEAL_PROMOTION_MODE',
        code: 'invalid_enum',
        message:
          'SELF_HEAL_PROMOTION_MODE is invalid; expected one of: manual, ci_acknowledged. Using "manual".',
        applied: 'manual',
      },
    ]);
  });

  it('reports invalid booleans and applies defaults', () => {
    const resolution = resolveSelfHealingConfigWithDiagnostics({
      SELF_HEAL_MODE: 'guarded',
      SELF_HEAL_SAT_ENABLED: 'maybe',
      SELF_HEAL_SAT_CAPTURE_DOM: '2',
    });

    expect(resolution.config.sat.enabled).toBe(true);
    expect(resolution.config.sat.captureDom).toBe(true);
    expect(resolution.diagnostics.map(({ envVar, code }) => ({ envVar, code }))).toEqual([
      { envVar: 'SELF_HEAL_SAT_ENABLED', code: 'invalid_boolean' },
      { envVar: 'SELF_HEAL_SAT_CAPTURE_DOM', code: 'invalid_boolean' },
    ]);
  });

  it('reports invalid, out-of-range, and clamped numbers', () => {
    const resolution = resolveSelfHealingConfigWithDiagnostics({
      SELF_HEAL_MIN_CONFIDENCE: '1.5',
      SELF_HEAL_MAX_DOM_NODES: 'zero',
      SELF_HEAL_MAX_CANDIDATES: '1.5',
      SELF_HEAL_MAX_TEXT_LENGTH: '900',
    });

    expect(resolution.config.minConfidence).toBe(DEFAULT_SELF_HEAL_MIN_CONFIDENCE);
    expect(resolution.config.sat.maxDomNodes).toBe(DEFAULT_SELF_HEAL_MAX_DOM_NODES);
    expect(resolution.config.sat.maxCandidates).toBe(DEFAULT_SELF_HEAL_MAX_CANDIDATES);
    expect(resolution.config.sat.maxTextLength).toBe(500);
    expect(resolution.diagnostics.map(({ envVar, code }) => ({ envVar, code }))).toEqual([
      { envVar: 'SELF_HEAL_MIN_CONFIDENCE', code: 'out_of_range' },
      { envVar: 'SELF_HEAL_MAX_DOM_NODES', code: 'invalid_number' },
      { envVar: 'SELF_HEAL_MAX_CANDIDATES', code: 'invalid_number' },
      { envVar: 'SELF_HEAL_MAX_TEXT_LENGTH', code: 'clamped' },
    ]);
  });

  it('reports unsupported action list values', () => {
    const partiallyValid = resolveSelfHealingConfigWithDiagnostics({
      SELF_HEAL_ALLOWED_ACTIONS: 'click,fly,type',
    });
    const allInvalid = resolveSelfHealingConfigWithDiagnostics({
      SELF_HEAL_ALLOWED_ACTIONS: 'fly,swim',
    });

    expect(partiallyValid.config.safetyPolicy.allowedActions).toEqual(['click', 'type']);
    expect(partiallyValid.diagnostics).toMatchObject([
      {
        envVar: 'SELF_HEAL_ALLOWED_ACTIONS',
        code: 'unsupported_list_values',
        applied: 'click,type',
      },
    ]);
    expect(allInvalid.config.safetyPolicy.allowedActions).toEqual([
      'click',
      'type',
      'read',
      'wait',
      'screenshot',
    ]);
    expect(allInvalid.diagnostics).toMatchObject([
      {
        envVar: 'SELF_HEAL_ALLOWED_ACTIONS',
        code: 'unsupported_list_values',
        applied: 'click,type,read,wait,screenshot',
      },
    ]);
  });

  it('reports an invalid strict flag and stays non-strict', () => {
    const resolution = resolveSelfHealingConfigWithDiagnostics({
      [SELF_HEAL_CONFIG_STRICT_ENV]: 'always',
    });

    expect(resolution.strict).toBe(false);
    expect(resolution.diagnostics).toMatchObject([
      { envVar: SELF_HEAL_CONFIG_STRICT_ENV, code: 'invalid_boolean', applied: 'false' },
    ]);
  });

  it('never echoes received environment values in diagnostics', () => {
    const secret = 'sk-live-EXAMPLE-NOT-REAL-12345';
    const resolution = resolveSelfHealingConfigWithDiagnostics({
      SELF_HEAL_MODE: secret,
      SELF_HEAL_MIN_CONFIDENCE: secret,
      SELF_HEAL_SAT_ENABLED: secret,
      SELF_HEAL_MAX_DOM_NODES: secret,
      SELF_HEAL_ALLOWED_ACTIONS: secret,
      SELF_HEAL_REGISTRY_MODE: secret,
      SELF_HEAL_PROMOTION_MODE: secret,
      [SELF_HEAL_CONFIG_STRICT_ENV]: secret,
    });

    expect(resolution.diagnostics.length).toBeGreaterThanOrEqual(8);
    const serialized = JSON.stringify(resolution.diagnostics);
    expect(serialized).not.toContain(secret);
    expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase());
  });
});

describe('describeEffectiveSelfHealingConfig', () => {
  it('returns a serializable snapshot detached from the resolved config', () => {
    const config = resolveSelfHealingConfig({ SELF_HEAL_MODE: 'guarded' });
    const snapshot = describeEffectiveSelfHealingConfig(config);

    expect(snapshot).toEqual(JSON.parse(JSON.stringify(config)));
    expect(snapshot).not.toBe(config);
    (snapshot.safetyPolicy as { allowedActions: string[] }).allowedActions.push('navigate');
    expect(config.safetyPolicy.allowedActions).not.toContain('navigate');
  });
});
