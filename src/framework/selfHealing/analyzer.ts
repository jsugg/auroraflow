import type { Page } from 'playwright';
import { buildSelfHealingCandidateId, rankSelfHealingCandidates } from './candidateScoring';
import { extractDomCandidateSeeds } from './domCandidateExtraction';
import { captureDomSnapshot, summarizeDomSnapshot } from './domSnapshot';
import { generateRankedLocatorSuggestions } from './suggestionEngine';
import type { SelfHealingCandidateSeed } from './candidateTypes';
import type { SelectorRegistryEntry, SelfHealingRegistryRuntime } from './registryContracts';
import type {
  SelectorCandidateHistory,
  SelfHealingActionContext,
  SelfHealingConfig,
  SelfHealingSatAnalysis,
  SelfHealingSuggestion,
  SelectorCandidateHistorySummary,
} from './types';

export interface SelfHealingFailureContext {
  page: Page;
  config: SelfHealingConfig;
  pageObjectName: string;
  action: SelfHealingActionContext;
  currentUrl?: string;
  existingSuggestions?: readonly SelfHealingSuggestion[];
  registryRuntime?: SelfHealingRegistryRuntime;
}

export interface SelfHealingAnalysisResult {
  suggestions: readonly SelfHealingSuggestion[];
  sat?: SelfHealingSatAnalysis;
}

function emptyHistorySummary(): SelectorCandidateHistorySummary {
  return {
    enabled: false,
    observations: 0,
    loadedCandidates: 0,
    warnings: [],
  };
}

function buildHistorySummary({
  enabled,
  histories,
  warnings,
}: {
  enabled: boolean;
  histories: ReadonlyMap<string, SelectorCandidateHistory>;
  warnings: readonly string[];
}): SelectorCandidateHistorySummary {
  return {
    enabled,
    observations: [...histories.values()].reduce((total, history) => total + history.attempts, 0),
    loadedCandidates: histories.size,
    warnings,
  };
}

function toRegistryWarning(error: unknown, context: string): string {
  return error instanceof Error
    ? `${context}: ${error.message}`
    : `${context}: unknown registry error`;
}

async function loadRegistryEntries({
  runtime,
  pageObjectName,
  action,
  maxCandidates,
}: {
  runtime: SelfHealingRegistryRuntime | undefined;
  pageObjectName: string;
  action: SelfHealingActionContext;
  maxCandidates: number;
}): Promise<{ entries: SelectorRegistryEntry[]; warnings: string[] }> {
  if (!runtime) {
    return {
      entries: [],
      warnings: [
        'Self-healing registry read mode is enabled, but no registry runtime is configured.',
      ],
    };
  }

  const entriesById = new Map<string, SelectorRegistryEntry>();
  const warnings: string[] = [];

  if (action.selectorId) {
    try {
      const entry = await runtime.selectors.get(action.selectorId);
      if (entry) {
        entriesById.set(entry.id, entry);
      } else {
        warnings.push(
          `No active selector registry record found for selectorId ${action.selectorId}.`,
        );
      }
    } catch (error: unknown) {
      warnings.push(toRegistryWarning(error, 'Active selector registry lookup failed'));
    }
  }

  if (runtime.selectors.findCandidates) {
    try {
      const entries = await runtime.selectors.findCandidates({
        pageObjectName,
        actionType: action.type,
        selectorId: action.selectorId,
        limit: maxCandidates,
      });
      for (const entry of entries) {
        entriesById.set(entry.id, entry);
      }
    } catch (error: unknown) {
      warnings.push(toRegistryWarning(error, 'Indexed selector registry lookup failed'));
    }
  }

  return {
    entries: [...entriesById.values()],
    warnings,
  };
}

function collectCandidateHistoryIds({
  pageObjectName,
  action,
  suggestions,
  domCandidates,
  registryCandidates,
}: {
  pageObjectName: string;
  action: SelfHealingActionContext;
  suggestions: readonly SelfHealingSuggestion[];
  domCandidates: readonly SelfHealingCandidateSeed[];
  registryCandidates: readonly SelectorRegistryEntry[];
}): string[] {
  const candidateIds = new Set<string>();
  const addCandidateId = ({
    locator,
    strategy,
    selectorId,
  }: {
    locator: string;
    strategy: SelfHealingSuggestion['strategy'];
    selectorId?: string;
  }): void => {
    candidateIds.add(
      buildSelfHealingCandidateId({
        pageObjectName,
        actionType: action.type,
        failedTarget: action.target,
        selectorId,
        strategy,
        locator,
      }),
    );
  };

  for (const suggestion of suggestions) {
    addCandidateId({
      locator: suggestion.locator,
      strategy: suggestion.strategy,
      selectorId: action.selectorId,
    });
  }
  for (const candidate of domCandidates) {
    addCandidateId({
      locator: candidate.locator,
      strategy: candidate.strategy,
      selectorId: action.selectorId,
    });
  }
  for (const candidate of registryCandidates) {
    addCandidateId({
      locator: candidate.locator,
      strategy: 'registry',
      selectorId: action.selectorId ?? candidate.id,
    });
  }

  return [...candidateIds];
}

async function loadCandidateHistories({
  runtime,
  candidateIds,
}: {
  runtime: SelfHealingRegistryRuntime | undefined;
  candidateIds: readonly string[];
}): Promise<{ histories: ReadonlyMap<string, SelectorCandidateHistory>; warnings: string[] }> {
  if (!runtime || candidateIds.length === 0) {
    return { histories: new Map(), warnings: [] };
  }

  try {
    return { histories: await runtime.histories.getMany(candidateIds), warnings: [] };
  } catch (error: unknown) {
    return {
      histories: new Map(),
      warnings: [toRegistryWarning(error, 'Selector candidate history lookup failed')],
    };
  }
}

export async function analyzeSelfHealingFailure({
  page,
  config,
  pageObjectName,
  action,
  currentUrl,
  existingSuggestions,
  registryRuntime,
}: SelfHealingFailureContext): Promise<SelfHealingAnalysisResult> {
  const suggestions =
    existingSuggestions ??
    generateRankedLocatorSuggestions({
      actionType: action.type,
      failedTarget: action.target,
    });

  if (config.mode === 'off') {
    return { suggestions };
  }

  if (!config.sat.enabled) {
    return {
      suggestions,
      sat: {
        schemaVersion: '1.0.0',
        enabled: false,
        candidates: [],
        history: emptyHistorySummary(),
        analysisWarnings: [],
      },
    };
  }

  const analysisWarnings: string[] = [];
  const domCandidates: SelfHealingCandidateSeed[] = [];
  let snapshotSummary: SelfHealingSatAnalysis['snapshot'];

  if (config.sat.captureDom) {
    try {
      const snapshot = await captureDomSnapshot(page, {
        maxDomNodes: config.sat.maxDomNodes,
        maxTextLength: config.sat.maxTextLength,
        allowedAttributes: config.sat.allowedAttributes,
        currentUrl,
      });
      snapshotSummary = summarizeDomSnapshot(snapshot);
      domCandidates.push(
        ...extractDomCandidateSeeds({
          snapshot,
          actionType: action.type,
          maxTextLength: config.sat.maxTextLength,
        }),
      );
    } catch (error: unknown) {
      analysisWarnings.push(
        error instanceof Error
          ? `DOM snapshot capture failed: ${error.message}`
          : 'DOM snapshot capture failed with an unknown error.',
      );
    }
  }

  const registryReadEnabled = config.sat.registryMode !== 'off';
  const { entries: registryCandidates, warnings: registryWarnings } = registryReadEnabled
    ? await loadRegistryEntries({
        runtime: registryRuntime,
        pageObjectName,
        action,
        maxCandidates: config.sat.maxCandidates,
      })
    : { entries: [], warnings: [] };
  analysisWarnings.push(...registryWarnings);

  const historyCandidateIds = registryReadEnabled
    ? collectCandidateHistoryIds({
        pageObjectName,
        action,
        suggestions,
        domCandidates,
        registryCandidates,
      })
    : [];
  const { histories: candidateHistories, warnings: historyWarnings } = await loadCandidateHistories(
    {
      runtime: registryRuntime,
      candidateIds: historyCandidateIds,
    },
  );
  analysisWarnings.push(...historyWarnings);

  const candidates = rankSelfHealingCandidates({
    pageObjectName,
    actionType: action.type,
    failedTarget: action.target,
    selectorId: action.selectorId,
    heuristicSuggestions: suggestions,
    domCandidates,
    registryCandidates,
    candidateHistories,
    maxCandidates: config.sat.maxCandidates,
  });
  const historySummary = buildHistorySummary({
    enabled: registryReadEnabled,
    histories: candidateHistories,
    warnings: [...registryWarnings, ...historyWarnings],
  });

  return {
    suggestions,
    sat: {
      schemaVersion: '1.0.0',
      enabled: true,
      snapshot: snapshotSummary,
      candidates,
      history: historySummary,
      selectedCandidateId: candidates[0]?.id,
      analysisWarnings,
    },
  };
}
