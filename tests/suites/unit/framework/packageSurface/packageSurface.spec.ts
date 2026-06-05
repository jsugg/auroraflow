import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AlertPolicyValidationError,
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  LoggerConfigError,
  PageFactory,
  PageObjectBase,
  RedisClient,
  RedisConfigError,
  SelectorRegistryRepository,
  buildFlakinessSummary,
  buildSloDashboard,
  captureFailureEvent,
  createChildLogger,
  createConfiguredLogger,
  evaluateAlertPolicy,
  evaluateGuardedSuggestionsDryRun,
  generateRankedLocatorSuggestions,
  parseAlertPolicy,
  resolveCorrelationIdentifiers,
  resolveLoggerRuntimeConfig,
  resolveRedisRuntimeConfig,
  resolveSelfHealingConfig,
  retry,
  type AlertPolicy,
  type CapturedFailureEvent,
  type FlakinessSummary,
  type LogDestination,
  type LoggerRuntimeConfig,
  type RedisRuntimeConfig,
  type SelfHealingConfig,
  type SelectorRecord,
  type SloDashboard,
} from '../../../../../src';

describe('public package surface', () => {
  it('exports stable runtime primitives from the root entrypoint', () => {
    expect(PageFactory).toBeTypeOf('function');
    expect(PageObjectBase).toBeTypeOf('function');
    expect(RedisClient).toBeTypeOf('function');
    expect(RedisConfigError).toBeTypeOf('function');
    expect(SelectorRegistryRepository).toBeTypeOf('function');
    expect(AlertPolicyValidationError).toBeTypeOf('function');
    expect(LoggerConfigError).toBeTypeOf('function');
    expect(DEFAULT_SELF_HEAL_MIN_CONFIDENCE).toBe(0.92);

    expect(buildFlakinessSummary).toBeTypeOf('function');
    expect(buildSloDashboard).toBeTypeOf('function');
    expect(captureFailureEvent).toBeTypeOf('function');
    expect(createChildLogger).toBeTypeOf('function');
    expect(createConfiguredLogger).toBeTypeOf('function');
    expect(evaluateAlertPolicy).toBeTypeOf('function');
    expect(evaluateGuardedSuggestionsDryRun).toBeTypeOf('function');
    expect(generateRankedLocatorSuggestions).toBeTypeOf('function');
    expect(parseAlertPolicy).toBeTypeOf('function');
    expect(resolveCorrelationIdentifiers).toBeTypeOf('function');
    expect(resolveLoggerRuntimeConfig).toBeTypeOf('function');
    expect(resolveRedisRuntimeConfig).toBeTypeOf('function');
    expect(resolveSelfHealingConfig).toBeTypeOf('function');
    expect(retry).toBeTypeOf('function');
  });

  it('exports typed contracts needed by downstream consumers', () => {
    expectTypeOf<RedisRuntimeConfig>().toMatchTypeOf<{
      host: string;
      port: number;
      database: number;
      tls: boolean;
      connectTimeoutMs: number;
      maxRetries: number;
      baseBackoffMs: number;
      maxBackoffMs: number;
      keyPrefix: string;
    }>();
    expectTypeOf<LogDestination>().toEqualTypeOf<'both' | 'console' | 'file' | 'silent'>();
    expectTypeOf<LoggerRuntimeConfig>().toMatchTypeOf<{
      level: string;
      destination: LogDestination;
      filePath: string;
      redactEnabled: boolean;
      redactPaths: string[];
      redactCensor: string;
    }>();
    expectTypeOf<SelfHealingConfig['mode']>().toEqualTypeOf<'off' | 'suggest' | 'guarded'>();
    expectTypeOf<SelectorRecord>().toMatchTypeOf<{
      id: string;
      locator: string;
      version: number;
    }>();
    expectTypeOf<CapturedFailureEvent['artifactVersion']>().toEqualTypeOf<'1.0.0'>();
    expectTypeOf<AlertPolicy>().toMatchTypeOf<{ version: '1.0.0'; alerts: unknown[] }>();
    expectTypeOf<FlakinessSummary['status']>().toEqualTypeOf<'complete' | 'no-input'>();
    expectTypeOf<SloDashboard['overallStatus']>().toEqualTypeOf<
      'healthy' | 'degraded' | 'insufficient_data'
    >();
  });
});
