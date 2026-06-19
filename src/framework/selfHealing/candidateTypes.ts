import type { CandidateLocator } from './candidateLocator';
import type { CandidateEvidence, SelfHealingSuggestionStrategy } from './types';

export interface SelfHealingCandidateSeed {
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  rationale: string;
  evidence: CandidateEvidence;
  /** Structured locator backing `locator` (`AUR-IMPL-020`), when the producer knows it. */
  candidateLocator?: CandidateLocator;
}
