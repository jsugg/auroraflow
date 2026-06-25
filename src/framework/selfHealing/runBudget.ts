import type { Logger } from '../../utils/logger';
import type { SelfHealingRunBudgetConfig } from './types';

export type SelfHealingRunBudgetDowngrade = 'none' | 'capture_only' | 'original_error_only';

export interface SelfHealingRunBudgetDecision {
  readonly mode: SelfHealingRunBudgetConfig['mode'];
  readonly healingAttemptSequence: number;
  readonly failureArtifactSequence: number;
  readonly maxHealingAttempts: number;
  readonly maxFailureArtifacts: number;
  readonly exceeded: boolean;
  readonly shouldRunHealing: boolean;
  readonly shouldCaptureArtifact: boolean;
  readonly downgrade: SelfHealingRunBudgetDowngrade;
}

export interface SelfHealingRunBudgetController {
  consumeFailure(
    config: SelfHealingRunBudgetConfig,
    logger: Pick<Logger, 'warn'>,
  ): SelfHealingRunBudgetDecision;
}

export function createSelfHealingRunBudgetController(): SelfHealingRunBudgetController {
  let healingAttemptCount = 0;
  let failureArtifactCount = 0;
  let warned = false;

  return {
    consumeFailure(config, logger) {
      healingAttemptCount += 1;
      failureArtifactCount += 1;

      const withinHealingBudget = healingAttemptCount <= config.maxHealingAttempts;
      const withinArtifactBudget = failureArtifactCount <= config.maxFailureArtifacts;
      const exceeded = !withinHealingBudget || !withinArtifactBudget;
      const warningOnly = config.mode === 'warning_only';
      const shouldCaptureArtifact = warningOnly || withinArtifactBudget;
      const shouldRunHealing = shouldCaptureArtifact && (warningOnly || withinHealingBudget);
      const downgrade: SelfHealingRunBudgetDowngrade = shouldRunHealing
        ? 'none'
        : shouldCaptureArtifact
          ? 'capture_only'
          : 'original_error_only';

      if (exceeded && !warned) {
        warned = true;
        logger.warn('Self-healing run budget exceeded.', {
          mode: config.mode,
          maxHealingAttempts: config.maxHealingAttempts,
          maxFailureArtifacts: config.maxFailureArtifacts,
          healingAttemptSequence: healingAttemptCount,
          failureArtifactSequence: failureArtifactCount,
          downgrade,
        });
      }

      return {
        mode: config.mode,
        healingAttemptSequence: healingAttemptCount,
        failureArtifactSequence: failureArtifactCount,
        maxHealingAttempts: config.maxHealingAttempts,
        maxFailureArtifacts: config.maxFailureArtifacts,
        exceeded,
        shouldRunHealing,
        shouldCaptureArtifact,
        downgrade,
      };
    },
  };
}
