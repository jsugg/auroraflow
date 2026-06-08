import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AlertPolicyValidationError,
  DEFAULT_SELF_HEAL_MAX_CANDIDATES,
  SelfHealingArtifactSchemaError,
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  LoggerConfigError,
  METRIC_NAMES,
  PageFactory,
  PageObjectBase,
  RESOURCE_ATTRIBUTE_NAMES,
  RedisClient,
  RedisConfigError,
  SelectorRegistryConflictError,
  SelectorRegistryRepository,
  analyzeSelfHealingFailure,
  buildFlakinessSummary,
  buildSelfHealingCandidateId,
  buildSloDashboard,
  captureFailureEvent,
  captureDomSnapshot,
  createChildLogger,
  createConfiguredLogger,
  createRedisSelfHealingRegistryRuntime,
  createRedisSelectorStore,
  createStoreSelfHealingRegistryRuntime,
  evaluateAlertPolicy,
  evaluateGuardedSuggestionsDryRun,
  extractDomCandidateSeeds,
  generateRankedLocatorSuggestions,
  getTelemetry,
  initializeTelemetry,
  parseAlertPolicy,
  parseDomSnapshot,
  rankSelfHealingCandidates,
  resolveCorrelationIdentifiers,
  resolveLoggerRuntimeConfig,
  resolveRedisRuntimeConfig,
  resolveSelfHealingRegistryRuntime,
  resolveSelfHealingConfig,
  resolveTelemetryConfig,
  retry,
  type AlertPolicy,
  type AuroraFlowTelemetry,
  type CapturedFailureEvent,
  type DomSnapshot,
  type FlakinessSummary,
  type LogDestination,
  type LoggerRuntimeConfig,
  type RankedSelfHealingCandidate,
  type RedisRuntimeConfig,
  type ResolveSelfHealingRegistryRuntimeOptions,
  type SelfHealingConfig,
  type SelfHealingRegistryRuntime,
  type SelectorCandidateHistoryRepository,
  type SelectorRegistryNamespaces,
  type SelectorRecord,
  type SelectorRegistryReader,
  type SelectorUpsertOptions,
  type SloDashboard,
} from '../../../../../src';

describe('public package surface', () => {
  it('exports stable runtime primitives from the root entrypoint', () => {
    expect(PageFactory).toBeTypeOf('function');
    expect(PageObjectBase).toBeTypeOf('function');
    expect(RedisClient).toBeTypeOf('function');
    expect(RedisConfigError).toBeTypeOf('function');
    expect(SelectorRegistryConflictError).toBeTypeOf('function');
    expect(SelectorRegistryRepository).toBeTypeOf('function');
    expect(AlertPolicyValidationError).toBeTypeOf('function');
    expect(LoggerConfigError).toBeTypeOf('function');
    expect(SelfHealingArtifactSchemaError).toBeTypeOf('function');
    expect(DEFAULT_SELF_HEAL_MIN_CONFIDENCE).toBe(0.92);
    expect(DEFAULT_SELF_HEAL_MAX_CANDIDATES).toBe(10);
    expect(METRIC_NAMES.pageActionsTotal).toBe('auroraflow_page_actions_total');
    expect(RESOURCE_ATTRIBUTE_NAMES).toContain('service.name');

    expect(analyzeSelfHealingFailure).toBeTypeOf('function');
    expect(buildFlakinessSummary).toBeTypeOf('function');
    expect(buildSelfHealingCandidateId).toBeTypeOf('function');
    expect(buildSloDashboard).toBeTypeOf('function');
    expect(captureFailureEvent).toBeTypeOf('function');
    expect(captureDomSnapshot).toBeTypeOf('function');
    expect(createChildLogger).toBeTypeOf('function');
    expect(createConfiguredLogger).toBeTypeOf('function');
    expect(createRedisSelfHealingRegistryRuntime).toBeTypeOf('function');
    expect(createRedisSelectorStore).toBeTypeOf('function');
    expect(createStoreSelfHealingRegistryRuntime).toBeTypeOf('function');
    expect(evaluateAlertPolicy).toBeTypeOf('function');
    expect(evaluateGuardedSuggestionsDryRun).toBeTypeOf('function');
    expect(extractDomCandidateSeeds).toBeTypeOf('function');
    expect(generateRankedLocatorSuggestions).toBeTypeOf('function');
    expect(getTelemetry).toBeTypeOf('function');
    expect(initializeTelemetry).toBeTypeOf('function');
    expect(parseAlertPolicy).toBeTypeOf('function');
    expect(parseDomSnapshot).toBeTypeOf('function');
    expect(rankSelfHealingCandidates).toBeTypeOf('function');
    expect(resolveCorrelationIdentifiers).toBeTypeOf('function');
    expect(resolveLoggerRuntimeConfig).toBeTypeOf('function');
    expect(resolveRedisRuntimeConfig).toBeTypeOf('function');
    expect(resolveSelfHealingRegistryRuntime).toBeTypeOf('function');
    expect(resolveSelfHealingConfig).toBeTypeOf('function');
    expect(resolveTelemetryConfig).toBeTypeOf('function');
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
    expectTypeOf<SelfHealingConfig['sat']['registryMode']>().toEqualTypeOf<
      'off' | 'read' | 'write_pending'
    >();
    expectTypeOf<SelfHealingRegistryRuntime>().toMatchTypeOf<{
      selectors: SelectorRegistryReader;
      histories: SelectorCandidateHistoryRepository;
      required: boolean;
    }>();
    expectTypeOf<ResolveSelfHealingRegistryRuntimeOptions>().toMatchTypeOf<object>();
    expectTypeOf<SelectorRecord>().toMatchTypeOf<{
      id: string;
      locator: string;
      version: number;
    }>();
    expectTypeOf<SelectorRegistryNamespaces>().toMatchTypeOf<{
      active: string;
      history: string;
      promotions: string;
      audit: string;
    }>();
    expectTypeOf<SelectorUpsertOptions>().toMatchTypeOf<{
      expectedVersion?: number | null;
    }>();
    expectTypeOf<CapturedFailureEvent['artifactVersion']>().toEqualTypeOf<'1.0.0'>();
    expectTypeOf<CapturedFailureEvent['sat']>().toMatchTypeOf<
      | {
          enabled: boolean;
          candidates: readonly RankedSelfHealingCandidate[];
        }
      | undefined
    >();
    expectTypeOf<DomSnapshot['schemaVersion']>().toEqualTypeOf<'1.0.0'>();
    expectTypeOf<AlertPolicy>().toMatchTypeOf<{ version: '1.0.0'; alerts: unknown[] }>();
    expectTypeOf<FlakinessSummary['status']>().toEqualTypeOf<'complete' | 'no-input'>();
    expectTypeOf<SloDashboard['overallStatus']>().toEqualTypeOf<
      'healthy' | 'degraded' | 'insufficient_data'
    >();
    expectTypeOf<AuroraFlowTelemetry>().toMatchTypeOf<{
      isEnabled(): boolean;
      shutdown(): Promise<void>;
    }>();
  });
});
