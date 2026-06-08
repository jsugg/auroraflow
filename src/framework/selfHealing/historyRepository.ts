import {
  DEFAULT_SELECTOR_REGISTRY_NAMESPACES,
  buildSelectorRegistryNamespaces,
  type SelectorStore,
} from '../../data/selectors/selectorRegistry';
import { parseSelectorCandidateHistory } from './artifactSchema';
import type {
  SelectorCandidateHistoryObservation,
  SelectorCandidateHistoryRepository,
} from './registryContracts';
import type { SelectorCandidateHistory } from './types';

export const DEFAULT_SELECTOR_CANDIDATE_HISTORY_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface StoreSelectorCandidateHistoryRepositoryOptions {
  store: SelectorStore;
  activeNamespace?: string;
  ttlSeconds?: number;
}

function normalizeTtlSeconds(ttlSeconds: number): number {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('selector history ttlSeconds must be a positive integer.');
  }
  return ttlSeconds;
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('history observation observedAt must be an ISO timestamp.');
  }
  return new Date(timestampMs + seconds * 1000).toISOString();
}

function emptyHistory(candidateId: string): SelectorCandidateHistory {
  return {
    candidateId,
    attempts: 0,
    validated: 0,
    guardedApplySucceeded: 0,
    guardedApplyFailed: 0,
    promoted: 0,
    rejected: 0,
  };
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

    const existing = (await this.get(candidateId)) ?? emptyHistory(candidateId);
    const guardedApplySucceeded = observation.guardedApplySucceeded === true;
    const guardedApplyFailed = observation.guardedApplyFailed === true;
    const validationAccepted = observation.validationAccepted === true;
    const updated: SelectorCandidateHistory = {
      ...existing,
      candidateId,
      attempts: existing.attempts + 1,
      validated: existing.validated + (validationAccepted ? 1 : 0),
      guardedApplySucceeded: existing.guardedApplySucceeded + (guardedApplySucceeded ? 1 : 0),
      guardedApplyFailed: existing.guardedApplyFailed + (guardedApplyFailed ? 1 : 0),
      lastSeenAt: observation.observedAt,
      lastSuccessAt: guardedApplySucceeded ? observation.observedAt : existing.lastSuccessAt,
      expiresAt: addSeconds(observation.observedAt, this.ttlSeconds),
    };

    await this.store.set(this.keyFor(candidateId), JSON.stringify(updated), {
      ttlSeconds: this.ttlSeconds,
    });
    return updated;
  }

  private keyFor(candidateId: string): string {
    return `${this.namespace}:${candidateId.trim()}`;
  }
}
