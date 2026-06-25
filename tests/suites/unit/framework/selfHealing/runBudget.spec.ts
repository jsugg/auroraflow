import { describe, expect, it, vi } from 'vitest';
import { createSelfHealingRunBudgetController } from '../../../../../src/framework/selfHealing/runBudget';
import type { SelfHealingRunBudgetConfig } from '../../../../../src/framework/selfHealing/types';

function budgetConfig(
  overrides: Partial<SelfHealingRunBudgetConfig> = {},
): SelfHealingRunBudgetConfig {
  return { mode: 'enforce', maxHealingAttempts: 1, maxFailureArtifacts: 2, ...overrides };
}

describe('createSelfHealingRunBudgetController', () => {
  it('enforces a two-stage downgrade and warns exactly once', () => {
    const controller = createSelfHealingRunBudgetController();
    const warn = vi.fn();
    const config = budgetConfig({ maxHealingAttempts: 1, maxFailureArtifacts: 2 });

    expect(controller.consumeFailure(config, { warn })).toMatchObject({
      mode: 'enforce',
      healingAttemptSequence: 1,
      failureArtifactSequence: 1,
      exceeded: false,
      shouldRunHealing: true,
      shouldCaptureArtifact: true,
      downgrade: 'none',
    });

    expect(controller.consumeFailure(config, { warn })).toMatchObject({
      healingAttemptSequence: 2,
      failureArtifactSequence: 2,
      exceeded: true,
      shouldRunHealing: false,
      shouldCaptureArtifact: true,
      downgrade: 'capture_only',
    });

    expect(controller.consumeFailure(config, { warn })).toMatchObject({
      healingAttemptSequence: 3,
      failureArtifactSequence: 3,
      exceeded: true,
      shouldRunHealing: false,
      shouldCaptureArtifact: false,
      downgrade: 'original_error_only',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Self-healing run budget exceeded.',
      expect.objectContaining({ mode: 'enforce', downgrade: 'capture_only' }),
    );
  });

  it('never downgrades in warning_only mode but still warns once when exceeded', () => {
    const controller = createSelfHealingRunBudgetController();
    const warn = vi.fn();
    const config = budgetConfig({
      mode: 'warning_only',
      maxHealingAttempts: 1,
      maxFailureArtifacts: 1,
    });

    expect(controller.consumeFailure(config, { warn })).toMatchObject({
      exceeded: false,
      shouldRunHealing: true,
      shouldCaptureArtifact: true,
      downgrade: 'none',
    });

    expect(controller.consumeFailure(config, { warn })).toMatchObject({
      exceeded: true,
      shouldRunHealing: true,
      shouldCaptureArtifact: true,
      downgrade: 'none',
    });

    expect(controller.consumeFailure(config, { warn })).toMatchObject({
      shouldRunHealing: true,
      downgrade: 'none',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Self-healing run budget exceeded.',
      expect.objectContaining({ mode: 'warning_only', downgrade: 'none' }),
    );
  });
});
