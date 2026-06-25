import { performance } from 'node:perf_hooks';
import { createChildLogger, type Logger } from '../../utils/logger';
import {
  resolveCorrelationIdentifiers,
  type CorrelationIdentifiers,
  type CorrelationInput,
} from '../observability/correlation';
import { getTelemetry, type AuroraFlowTelemetry } from '../observability/telemetry';
import { resolveSelfHealingConfig } from '../selfHealing/config';
import { resolveSelfHealingRegistryRuntime } from '../selfHealing/registryRuntime';
import {
  resolveArtifactPrivacyPolicy,
  type ArtifactPrivacyPolicy,
} from '../selfHealing/artifactPrivacy';
import { resolveFailureArtifactOutputDirectory } from '../selfHealing/failureCapture';
import {
  createSelfHealingRunBudgetController,
  type SelfHealingRunBudgetController,
  type SelfHealingRunBudgetDecision,
} from '../selfHealing/runBudget';
import type { SelfHealingConfig } from '../selfHealing/types';
import type { SelfHealingRegistryRuntime } from '../selfHealing/registryContracts';

type Environment = Readonly<Record<string, string | undefined>>;

/** Time source owned by a context so duration and timestamps stay injectable. */
export interface AuroraFlowClock {
  /** Monotonic millisecond reading used to measure action duration. */
  now(): number;
  /** Wall-clock instant used for artifact and screenshot timestamps. */
  currentDate(): Date;
}

/** Builds component-scoped loggers; mirrors {@link createChildLogger}. */
export type AuroraFlowLoggerFactory = (
  name: string,
  bindings?: Readonly<Record<string, string | undefined>>,
) => Logger;

/**
 * Runtime dependency container injected into the page-object facade.
 *
 * Every member has an env-backed default (see {@link createAuroraFlowContext}),
 * so existing constructors keep working unchanged. Supplying a context lets two
 * runs in the same process resolve telemetry, self-healing configuration,
 * registry runtime, privacy policy, artifact root, correlation, and time
 * independently, with no `process.env` read or telemetry-singleton access in the
 * action pipeline.
 */
export interface AuroraFlowContext {
  /** Creates a component logger bound to the supplied correlation metadata. */
  createLogger: AuroraFlowLoggerFactory;
  /** Resolves run/test identifiers, merging context defaults with any input. */
  resolveCorrelation(input?: CorrelationInput): CorrelationIdentifiers;
  /** Returns the telemetry sink for this context. */
  getTelemetry(): AuroraFlowTelemetry;
  /** Resolves the effective self-healing configuration for this context. */
  resolveSelfHealingConfig(): SelfHealingConfig;
  /** Resolves the optional selector registry runtime for the given configuration. */
  resolveRegistryRuntime(config: SelfHealingConfig): SelfHealingRegistryRuntime | undefined;
  /** Resolves the artifact privacy policy, reporting any diagnostic to the caller. */
  resolveArtifactPrivacyPolicy(onDiagnostic?: (diagnostic: string) => void): ArtifactPrivacyPolicy;
  /** Resolves the directory self-healing failure artifacts are written to. */
  resolveArtifactRoot(): string;
  /** Injectable time source for durations and timestamps. */
  readonly clock: AuroraFlowClock;
}

/**
 * Overrides for {@link createAuroraFlowContext}. Any member left unset falls
 * back to the historical env-backed default, so `createAuroraFlowContext()` with
 * no options reproduces the previous global behavior exactly.
 */
export interface AuroraFlowContextOptions {
  /** Environment read by env-backed defaults. Defaults to `process.env`. */
  env?: Environment;
  /** Component logger factory. Defaults to {@link createChildLogger}. */
  createLogger?: AuroraFlowLoggerFactory;
  /** Correlation defaults merged into every resolution (e.g. a fixed run id). */
  correlation?: CorrelationInput;
  /** Fixed telemetry sink. When set, the telemetry module singleton is never read. */
  telemetry?: AuroraFlowTelemetry;
  /** Fixed self-healing configuration. When set, `SELF_HEAL_*` env is never read. */
  selfHealingConfig?: SelfHealingConfig;
  /** Registry runtime resolver. Defaults to the env-backed Redis resolver. */
  resolveRegistryRuntime?: (config: SelfHealingConfig) => SelfHealingRegistryRuntime | undefined;
  /** Fixed artifact privacy policy. When set, the privacy-preset env is never read. */
  artifactPrivacyPolicy?: ArtifactPrivacyPolicy;
  /**
   * Fixed failure-artifact output root. When set, `SELF_HEAL_ARTIFACTS_DIR` env
   * is never read, so two contexts can write artifacts to isolated directories.
   */
  artifactRoot?: string;
  /** Time source overrides. Defaults to `performance.now()` and `new Date()`. */
  clock?: Partial<AuroraFlowClock>;
}

const defaultClock: AuroraFlowClock = {
  now: () => performance.now(),
  currentDate: () => new Date(),
};

const selfHealingRunBudgets = new WeakMap<AuroraFlowContext, SelfHealingRunBudgetController>();

export function consumeSelfHealingRunBudget(
  context: AuroraFlowContext,
  config: SelfHealingConfig,
  logger: Parameters<SelfHealingRunBudgetController['consumeFailure']>[1],
): SelfHealingRunBudgetDecision {
  if (config.mode === 'off') {
    return {
      mode: config.runBudget.mode,
      healingAttemptSequence: 0,
      failureArtifactSequence: 0,
      maxHealingAttempts: config.runBudget.maxHealingAttempts,
      maxFailureArtifacts: config.runBudget.maxFailureArtifacts,
      exceeded: false,
      shouldRunHealing: false,
      shouldCaptureArtifact: false,
      downgrade: 'original_error_only',
    };
  }

  let controller = selfHealingRunBudgets.get(context);
  if (controller === undefined) {
    controller = createSelfHealingRunBudgetController();
    selfHealingRunBudgets.set(context, controller);
  }
  return controller.consumeFailure(config.runBudget, logger);
}

/**
 * Builds an {@link AuroraFlowContext}. With no options it reproduces the
 * historical env-backed, singleton behavior exactly; each option replaces one
 * port with an explicit dependency so multiple contexts can run in isolation
 * within a single process.
 */
export function createAuroraFlowContext(options: AuroraFlowContextOptions = {}): AuroraFlowContext {
  const env = options.env ?? process.env;
  const fixedTelemetry = options.telemetry;
  const fixedConfig = options.selfHealingConfig;
  const fixedPrivacyPolicy = options.artifactPrivacyPolicy;
  const fixedArtifactRoot = options.artifactRoot;
  const createLogger: AuroraFlowLoggerFactory =
    options.createLogger ?? ((name, bindings) => createChildLogger(name, bindings));
  const resolveRegistryRuntime =
    options.resolveRegistryRuntime ??
    ((config: SelfHealingConfig) => resolveSelfHealingRegistryRuntime(env, config));
  const clock: AuroraFlowClock = {
    now: options.clock?.now ?? defaultClock.now,
    currentDate: options.clock?.currentDate ?? defaultClock.currentDate,
  };

  const context: AuroraFlowContext = {
    createLogger,
    resolveCorrelation: (input) =>
      resolveCorrelationIdentifiers({
        correlation: { ...options.correlation, ...input },
        env,
      }),
    getTelemetry: fixedTelemetry ? () => fixedTelemetry : () => getTelemetry(),
    resolveSelfHealingConfig: fixedConfig ? () => fixedConfig : () => resolveSelfHealingConfig(env),
    resolveRegistryRuntime,
    resolveArtifactPrivacyPolicy: fixedPrivacyPolicy
      ? () => fixedPrivacyPolicy
      : (onDiagnostic) => resolveArtifactPrivacyPolicy(env, onDiagnostic),
    resolveArtifactRoot:
      fixedArtifactRoot !== undefined
        ? () => fixedArtifactRoot
        : () => resolveFailureArtifactOutputDirectory(env),
    clock,
  };
  selfHealingRunBudgets.set(context, createSelfHealingRunBudgetController());
  return context;
}
