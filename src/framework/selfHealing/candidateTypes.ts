import type { CandidateEvidence, SelfHealingSuggestionStrategy } from './types';

export interface SelfHealingCandidateSeed {
  locator: string;
  strategy: SelfHealingSuggestionStrategy;
  rationale: string;
  evidence: CandidateEvidence;
}
