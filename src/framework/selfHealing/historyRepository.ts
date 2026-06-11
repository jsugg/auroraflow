import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  buildSelectorRegistryNamespaces,
  type SelectorStore,
  type SelectorStoreJsonMergePatch,
  type SelectorStoreJsonObject,
} from '../../data/selectors/selectorRegistry';
import { parseSelectorCandidateHistory } from './artifactSchema';
import type {
  SelectorCandidateHistoryObservation,
  SelectorCandidateHistoryRepository,
} from './registryContracts';
import type { SelectorCandidateHistory } from './types';

export const MAX_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS =
  MAX_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS;

export interface StoreSelectorCandidateHistoryRepositoryOptions {
  store: SelectorStore;
  activeNamespace?: string;
  ttlSeconds?: number;
}

function normalizeTtlSeconds(ttlSeconds: number): number {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('selector history ttlSeconds must be a positive integer.');
  }
  return Math.min(ttlSeconds, MAX_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS);
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('history observation observedAt must be an ISO timestamp.');
  }
  return new Date(timestampMs + seconds * 1000).toISOString();
}

function defaultHistoryFields(candidateId: string): SelectorStoreJsonObject {
  return {
    candidateId,
    attempts: 0,
    validated: 0,
    guardedApplySucceeded: 0,
    guardedApplyFailed: 0,
    promoted: 0,
    rejected: 0,
    rolledBack: 0,
  };
}

export interface SelectorCandidateHistoryOutcomeUpdate {
  candidateId: string;
  observedAt: string;
  promoted?: number;
  rejected?: number;
  rolledBack?: number;
}

/** Store-backed SAT candidate-history repository with bounded TTL writes. */
export class StoreSelectorCandidateHistoryRepository implements SelectorCandidateHistoryRepository {
  private readonly namespace: string;

  private readonly ttlSeconds: number;

  public constructor({
    store,
    activeNamespace = DEFAULT_SELECTOR_REGISTRY_NAMESPACES.active,
    ttlSeconds = DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS,
  }: StoreSelectorCandidateHistoryRepositoryOptions) {
    this.store = store;
    this.namespace = buildSelectorRegistryNamespaces(activeNamespace).history;
    this.ttlSeconds = normalizeTtlSeconds(ttlSeconds);
  }

  private readonly store: SelectorStore;

  public async get(candidateId: string): Promise<SelectorCandidateHistory | null> {
    const payload = await this.store.get(this.keyFor(candidateId));
    if (payload === null) {
      return null;
    }
    return parseSelectorCandidateHistory(JSON.parse(payload) as unknown);
  }

  public async getMany(
    candidateIds: readonly string[],
  ): Promise<ReadonlyMap<string, SelectorCandidateHistory>> {
    if (candidateIds.length === 0) {
      return new Map();
    }

    const keys = candidateIds.map((candidateId) => this.keyFor(candidateId));
    const payloads = this.store.getMany
      ? await this.store.getMany(keys)
      : await Promise.all(keys.map((key) => this.store.get(key)));
    const histories = new Map<string, SelectorCandidateHistory>();

    for (let index = 0; index < candidateIds.length; index += 1) {
      const payload = payloads[index];
      if (payload === null || payload === undefined) {
        continue;
      }
      const history = parseSelectorCandidateHistory(JSON.parse(payload) as unknown);
      histories.set(candidateIds[index], history);
    }

    return histories;
  }

  public async recordObservation(
    observation: SelectorCandidateHistoryObservation,
  ): Promise<SelectorCandidateHistory> {
    const candidateId = observation.candidate.id.trim();
    if (!candidateId) {
      throw new Error('history observation candidate.id must be non-empty.');
    }

    const guardedApplySucceeded = observation.guardedApplySucceeded === true;
    const guardedApplyFailed = observation.guardedApplyFailed === true;
    const validationAccepted = observation.validationAccepted === true;
    const set: SelectorStoreJsonObject = {
      lastSeenAt: observation.observedAt,
      expiresAt: addSeconds(observation.observedAt, this.ttlSeconds),
      ...(guardedApplySucceeded ? { lastSuccessAt: observation.observedAt } : {}),
    };

    return this.mergeHistory(candidateId, {
      defaultValue: defaultHistoryFields(candidateId),
      increments: {
        attempts: 1,
        validated: validationAccepted ? 1 : 0,
        guardedApplySucceeded: guardedApplySucceeded ? 1 : 0,
        guardedApplyFailed: guardedApplyFailed ? 1 : 0,
      },
      set,
    });
  }

  public async recordOutcome(
    outcome: SelectorCandidateHistoryOutcomeUpdate,
  ): Promise<SelectorCandidateHistory> {
    const candidateId = outcome.candidateId.trim();
    if (!candidateId) {
      throw new Error('history outcome candidateId must be non-empty.');
    }

    return this.mergeHistory(candidateId, {
      defaultValue: defaultHistoryFields(candidateId),
      increments: {
        promoted: Math.max(0, Math.floor(outcome.promoted ?? 0)),
        rejected: Math.max(0, Math.floor(outcome.rejected ?? 0)),
        rolledBack: Math.max(0, Math.floor(outcome.rolledBack ?? 0)),
      },
      set: {
        lastSeenAt: outcome.observedAt,
        expiresAt: addSeconds(outcome.observedAt, this.ttlSeconds),
      },
    });
  }

  private async mergeHistory(
    candidateId: string,
    patch: SelectorStoreJsonMergePatch,
  ): Promise<SelectorCandidateHistory> {
    if (!this.store.atomicJsonMerge) {
      throw new Error(
        'SelectorStore.atomicJsonMerge is required for atomic candidate history writes.',
      );
    }

    const payload = await this.store.atomicJsonMerge(this.keyFor(candidateId), patch, {
      ttlSeconds: this.ttlSeconds,
    });
    return parseSelectorCandidateHistory(JSON.parse(payload) as unknown);
  }

  private keyFor(candidateId: string): string {
    return `${this.namespace}:${candidateId.trim()}`;
  }
}
