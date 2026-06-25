import type { PendingSelectorPromotion } from './types';

export type PromotionAuthorizationAction = 'approve' | 'reject' | 'rollback';
export type PromotionAuthorizationMode = 'local' | 'shared';

export interface PromotionAuthorizationEvidence {
  codeownersPresent: boolean;
  protectedWorkflow: boolean;
}

export interface PromotionAuthorizationInput {
  action: PromotionAuthorizationAction;
  activeNamespace: string;
  evidence: PromotionAuthorizationEvidence;
  promotion: PendingSelectorPromotion;
  reviewer: string;
}

export interface PromotionAuthorizationDecision {
  allowed: boolean;
  evidence: PromotionAuthorizationEvidence;
  mode: PromotionAuthorizationMode;
  reason?: string;
  warnings: readonly string[];
}

export interface PromotionAuthorizationPolicy {
  authorize(
    input: PromotionAuthorizationInput,
  ): PromotionAuthorizationDecision | Promise<PromotionAuthorizationDecision>;
}

export interface CreatePromotionAuthorizationPolicyOptions {
  codeownersPresent?: boolean;
  mode?: PromotionAuthorizationMode;
  protectedWorkflow?: boolean;
}

export class PromotionAuthorizationError extends Error {
  public constructor(public readonly decision: PromotionAuthorizationDecision) {
    super(decision.reason ?? 'Promotion mutation is not authorized.');
    this.name = 'PromotionAuthorizationError';
  }
}

const LOCAL_PROMOTION_WARNING =
  'Local promotion authorization is permissive; use shared mode with CODEOWNERS and a protected workflow for shared registries.';

function normalizeAuthorizationMode(
  mode: PromotionAuthorizationMode | undefined,
): PromotionAuthorizationMode {
  return mode ?? 'local';
}

/** Creates the built-in local/shared selector-promotion authorization policy. */
export function createPromotionAuthorizationPolicy({
  mode,
  codeownersPresent = false,
  protectedWorkflow = false,
}: CreatePromotionAuthorizationPolicyOptions = {}): PromotionAuthorizationPolicy {
  const resolvedMode = normalizeAuthorizationMode(mode);
  const evidence: PromotionAuthorizationEvidence = { codeownersPresent, protectedWorkflow };

  return {
    authorize(input: PromotionAuthorizationInput): PromotionAuthorizationDecision {
      const reviewer = input.reviewer.trim();
      if (!reviewer) {
        return {
          allowed: false,
          evidence,
          mode: resolvedMode,
          reason: 'Promotion reviewer must be non-empty.',
          warnings: [],
        };
      }

      if (resolvedMode === 'local') {
        return {
          allowed: true,
          evidence,
          mode: resolvedMode,
          warnings: [LOCAL_PROMOTION_WARNING],
        };
      }

      if (!evidence.codeownersPresent || !evidence.protectedWorkflow) {
        return {
          allowed: false,
          evidence,
          mode: resolvedMode,
          reason:
            'Shared promotion authorization requires CODEOWNERS and a protected workflow before mutating selectors.',
          warnings: [],
        };
      }

      return {
        allowed: true,
        evidence,
        mode: resolvedMode,
        warnings: [],
      };
    },
  };
}
