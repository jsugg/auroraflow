import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  STABILITY_TIERS,
  extractRootExports,
  findDuplicateNames,
  parseStabilityManifest,
} from '../../../../helpers/apiStabilitySurface';
import {
  AlertPolicyValidationError,
  DEFAULT_OBSERVABILITY_TREND_LIMIT,
  DEFAULT_SELF_HEAL_MAX_CANDIDATES,
  DEFAULT_PENDING_SELECTOR_PROMOTION_TTL_SECONDS,
  DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS,
  MAX_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS,
  SelfHealingArtifactSchemaError,
  DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  LoggerConfigError,
  METRIC_NAMES,
  OBSERVABILITY_TREND_SCHEMA_VERSION,
  ObservabilityTrendPersistenceError,
  PageFactory,
  PageObjectBase,
  RESOURCE_ATTRIBUTE_NAMES,
  RedisClient,
  RedisConfigError,
  SelectorRegistryConflictError,
  SelectorRegistryRepository,
  StorePendingSelectorPromotionRepository,
  StoreSelectorCandidateHistoryRepository,
  analyzeSelfHealingFailure,
  buildFlakinessSummary,
  buildObservabilityTrendPointFromFlakinessSummary,
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
  persistSelfHealingRegistryTelemetry,
  resolveCorrelationIdentifiers,
  resolveLoggerRuntimeConfig,
  resolveRedisRuntimeConfig,
  resolveSelfHealingRegistryRuntime,
  resolveSelfHealingConfig,
  resolveSelfHealingConfigWithDiagnostics,
  describeEffectiveSelfHealingConfig,
  SELF_HEAL_CONFIG_STRICT_ENV,
  SelfHealingConfigError,
  resolveTelemetryConfig,
  retry,
  type AlertPolicy,
  type AuroraFlowTelemetry,
  type CapturedFailureEvent,
  type DomSnapshot,
  type FlakinessSummary,
  type LogDestination,
  type LoggerRuntimeConfig,
  type ObservabilityTrendPoint,
  type RankedSelfHealingCandidate,
  type RedisRuntimeConfig,
  type ResolveSelfHealingRegistryRuntimeOptions,
  type SelfHealingConfig,
  type SelfHealingConfigDiagnostic,
  type SelfHealingConfigResolution,
  type SelfHealingRegistryPersistenceSummary,
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
    expect(ObservabilityTrendPersistenceError).toBeTypeOf('function');
    expect(SelfHealingArtifactSchemaError).toBeTypeOf('function');
    expect(StorePendingSelectorPromotionRepository).toBeTypeOf('function');
    expect(StoreSelectorCandidateHistoryRepository).toBeTypeOf('function');
    expect(DEFAULT_OBSERVABILITY_TREND_LIMIT).toBeGreaterThan(0);
    expect(DEFAULT_PENDING_SELECTOR_PROMOTION_TTL_SECONDS).toBeGreaterThan(0);
    expect(DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS).toBe(2_592_000);
    expect(MAX_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS).toBe(2_592_000);
    expect(DEFAULT_SELF_HEAL_MIN_CONFIDENCE).toBe(0.92);
    expect(DEFAULT_SELF_HEAL_MAX_CANDIDATES).toBe(10);
    expect(METRIC_NAMES.pageActionsTotal).toBe('auroraflow_page_actions_total');
    expect(RESOURCE_ATTRIBUTE_NAMES).toContain('service.name');

    expect(analyzeSelfHealingFailure).toBeTypeOf('function');
    expect(buildFlakinessSummary).toBeTypeOf('function');
    expect(buildObservabilityTrendPointFromFlakinessSummary).toBeTypeOf('function');
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
    expect(persistSelfHealingRegistryTelemetry).toBeTypeOf('function');
    expect(rankSelfHealingCandidates).toBeTypeOf('function');
    expect(resolveCorrelationIdentifiers).toBeTypeOf('function');
    expect(resolveLoggerRuntimeConfig).toBeTypeOf('function');
    expect(resolveRedisRuntimeConfig).toBeTypeOf('function');
    expect(resolveSelfHealingRegistryRuntime).toBeTypeOf('function');
    expect(resolveSelfHealingConfig).toBeTypeOf('function');
    expect(resolveSelfHealingConfigWithDiagnostics).toBeTypeOf('function');
    expect(describeEffectiveSelfHealingConfig).toBeTypeOf('function');
    expect(SELF_HEAL_CONFIG_STRICT_ENV).toBe('AURORAFLOW_CONFIG_STRICT');
    expect(SelfHealingConfigError).toBeTypeOf('function');
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
    expectTypeOf<SelfHealingConfigResolution>().toMatchTypeOf<{
      config: SelfHealingConfig;
      diagnostics: SelfHealingConfigDiagnostic[];
      strict: boolean;
    }>();
    expectTypeOf<SelfHealingConfigDiagnostic>().toMatchTypeOf<{
      envVar: string;
      message: string;
      applied: string;
    }>();
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
    expectTypeOf<CapturedFailureEvent['registryPersistence']>().toMatchTypeOf<
      SelfHealingRegistryPersistenceSummary | undefined
    >();
    expectTypeOf<DomSnapshot['schemaVersion']>().toEqualTypeOf<'1.0.0'>();
    expectTypeOf<AlertPolicy>().toMatchTypeOf<{ version: '1.0.0'; alerts: unknown[] }>();
    expectTypeOf<FlakinessSummary['status']>().toEqualTypeOf<'complete' | 'no-input'>();
    expectTypeOf<ObservabilityTrendPoint['schemaVersion']>().toEqualTypeOf<
      typeof OBSERVABILITY_TREND_SCHEMA_VERSION
    >();
    expectTypeOf<SloDashboard['overallStatus']>().toEqualTypeOf<
      'healthy' | 'degraded' | 'insufficient_data'
    >();
    expectTypeOf<AuroraFlowTelemetry>().toMatchTypeOf<{
      isEnabled(): boolean;
      shutdown(): Promise<void>;
    }>();
  });
});

describe('package surface classification helpers', () => {
  it('extracts runtime and type exports with aliases and inline type modifiers', () => {
    const source = [
      "export { Alpha, type AlphaOptions, Beta as Gamma } from './alpha';",
      "export type { Delta } from './delta';",
    ].join('\n');

    expect(extractRootExports(source)).toEqual([
      { name: 'Alpha', kind: 'runtime', source: './alpha' },
      { name: 'AlphaOptions', kind: 'type', source: './alpha' },
      { name: 'Gamma', kind: 'runtime', source: './alpha' },
      { name: 'Delta', kind: 'type', source: './delta' },
    ]);
  });

  it('rejects wildcard re-exports that would make the inventory open-ended', () => {
    expect(() => extractRootExports("export * from './alpha';")).toThrow(/export \*/);
  });

  it('rejects statements that are not named export declarations', () => {
    expect(() => extractRootExports('export const alpha = 1;')).toThrow(
      /only named export declarations/,
    );
  });

  it('parses manifest rows and ignores prose, headers, and non-manifest tables', () => {
    const markdown = [
      'Some prose about `inlineCode` that is not a table row.',
      '| Export | Kind | Tier |',
      '| --- | --- | --- |',
      '| `Alpha` | runtime | stable |',
      '| `AlphaOptions` | type | experimental |',
      '| Tier | Compatibility guarantee |',
      '| stable | Core supported API. |',
    ].join('\n');

    expect(parseStabilityManifest(markdown)).toEqual([
      { name: 'Alpha', kind: 'runtime', tier: 'stable' },
      { name: 'AlphaOptions', kind: 'type', tier: 'experimental' },
    ]);
  });

  it('fails loudly on unknown tiers and kinds instead of skipping rows', () => {
    expect(() => parseStabilityManifest('| `Alpha` | runtime | solid |')).toThrow(
      /Invalid stability tier 'solid'/,
    );
    expect(() => parseStabilityManifest('| `Alpha` | value | stable |')).toThrow(
      /Invalid export kind 'value'/,
    );
    expect(STABILITY_TIERS).toEqual([
      'stable',
      'advanced',
      'experimental',
      'deprecated',
      'internal',
    ]);
  });

  it('reports duplicate export names', () => {
    expect(findDuplicateNames([{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Alpha' }])).toEqual([
      'Alpha',
    ]);
    expect(findDuplicateNames([{ name: 'Alpha' }, { name: 'Beta' }])).toEqual([]);
  });
});
