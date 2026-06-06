import type { Page } from 'playwright';
import { rankSelfHealingCandidates } from './candidateScoring';
import { extractDomCandidateSeeds } from './domCandidateExtraction';
import { captureDomSnapshot, summarizeDomSnapshot } from './domSnapshot';
import { generateRankedLocatorSuggestions } from './suggestionEngine';
import type { SelfHealingCandidateSeed } from './candidateTypes';
import type {
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

export async function analyzeSelfHealingFailure({
  page,
  config,
  pageObjectName,
  action,
  currentUrl,
  existingSuggestions,
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

  const candidates = rankSelfHealingCandidates({
    pageObjectName,
    actionType: action.type,
    failedTarget: action.target,
    heuristicSuggestions: suggestions,
    domCandidates,
    maxCandidates: config.sat.maxCandidates,
  });

  return {
    suggestions,
    sat: {
      schemaVersion: '1.0.0',
      enabled: true,
      snapshot: snapshotSummary,
      candidates,
      history: emptyHistorySummary(),
      selectedCandidateId: candidates[0]?.id,
      analysisWarnings,
    },
  };
}
