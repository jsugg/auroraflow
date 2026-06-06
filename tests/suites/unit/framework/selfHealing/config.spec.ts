import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELF_HEAL_MAX_CANDIDATES,
  DEFAULT_SELF_HEAL_MAX_DOM_NODES,
  DEFAULT_SELF_HEAL_MAX_TEXT_LENGTH,
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
});
