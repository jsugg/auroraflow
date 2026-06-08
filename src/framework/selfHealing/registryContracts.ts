import type {
  PendingSelectorPromotion,
  RankedSelfHealingCandidate,
  SelectorCandidateHistory,
  SelfHealingActionType,
} from './types';

/** Active selector data visible to SAT without binding analysis code to Redis. */
export interface SelectorRegistryEntry {
  id: string;
  pageObjectName: string;
  actionType: string;
  locator: string;
  strategy?: string;
  confidence?: number;
  notes?: string;
  updatedAt: string;
  version: number;
}

/** Bounded lookup input for runtime selector discovery. */
export interface SelectorRegistryLookup {
  pageObjectName: string;
  actionType?: SelfHealingActionType;
  selectorId?: string;
  limit?: number;
}

/** Read-only active selector registry contract used by future SAT integration. */
export interface SelectorRegistryReader {
  /**
   * Reads one active selector by stable selector ID.
   *
   * @param selectorId - Stable selector ID from page action metadata.
   * @returns Active selector entry, or null when absent.
   */
  get(selectorId: string): Promise<SelectorRegistryEntry | null>;

  /**
   * Finds bounded active selectors for a page/action context.
   *
   * @param lookup - Page/action selector lookup constraints.
   * @returns Matching active selectors in repository-defined rank order.
   */
  findCandidates?(lookup: SelectorRegistryLookup): Promise<readonly SelectorRegistryEntry[]>;
}

/** Observation recorded when SAT ranks or validates a selector candidate. */
export interface SelectorCandidateHistoryObservation {
  candidate: RankedSelfHealingCandidate;
  eventId: string;
  observedAt: string;
  selectorId?: string;
  guardedApplySucceeded?: boolean;
  guardedApplyFailed?: boolean;
}

/** Candidate-history persistence contract used by future history-aware ranking. */
export interface SelectorCandidateHistoryRepository {
  /**
   * Reads one candidate history record.
   *
   * @param candidateId - Deterministic SAT candidate ID.
   * @returns Candidate history, or null when absent.
   */
  get(candidateId: string): Promise<SelectorCandidateHistory | null>;

  /**
   * Reads candidate histories in one bounded operation.
   *
   * @param candidateIds - Candidate IDs to load.
   * @returns Map keyed by candidate ID.
   */
  getMany(candidateIds: readonly string[]): Promise<ReadonlyMap<string, SelectorCandidateHistory>>;

  /**
   * Records one candidate observation when a repository supports writes.
   *
   * @param observation - Candidate observation and guarded outcome.
   * @returns Updated candidate history.
   */
  recordObservation?(
    observation: SelectorCandidateHistoryObservation,
  ): Promise<SelectorCandidateHistory>;
}

/** Promotion lookup constraints for review tooling. */
export interface PendingSelectorPromotionQuery {
  selectorId?: string;
  candidateId?: string;
  includeAcknowledged?: boolean;
  limit?: number;
}

/** Pending promotion persistence contract used by future reviewed workflows. */
export interface PendingSelectorPromotionRepository {
  /**
   * Reads one pending promotion by originating self-healing event ID.
   *
   * @param eventId - Self-healing failure event ID.
   * @returns Pending selector promotion, or null when absent.
   */
  get(eventId: string): Promise<PendingSelectorPromotion | null>;

  /**
   * Lists pending promotions for bounded review.
   *
   * @param query - Optional selector/candidate filters.
   * @returns Matching promotions in repository-defined rank order.
   */
  list(query?: PendingSelectorPromotionQuery): Promise<readonly PendingSelectorPromotion[]>;

  /**
   * Writes or replaces one pending promotion.
   *
   * @param promotion - Promotion request to persist.
   * @returns Persisted promotion record.
   */
  upsert(promotion: PendingSelectorPromotion): Promise<PendingSelectorPromotion>;
}

/** Optional persistence runtime passed to SAT without implementation coupling. */
export interface SelfHealingRegistryRuntime {
  selectors: SelectorRegistryReader;
  histories: SelectorCandidateHistoryRepository;
  promotions: PendingSelectorPromotionRepository;
  required: boolean;
}
