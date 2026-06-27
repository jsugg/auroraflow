import { describe, expect, it } from 'vitest';
import { rankSelfHealingCandidates } from '../../../../../src/framework/selfHealing/candidateScoring';
import type { SelfHealingCandidateSeed } from '../../../../../src/framework/selfHealing/candidateTypes';
import type { SelectorRegistryEntry } from '../../../../../src/framework/selfHealing/registryContracts';
import type { SelfHealingSuggestionStrategy } from '../../../../../src/framework/selfHealing/types';
import {
  forAll,
  randomBoolean,
  randomFrom,
  randomInt,
  type Random,
} from '../../../../helpers/propertyTesting';

/**
 * Property baseline for candidate scoring/ranking.
 *
 * Coverage proves these lines execute; these seeded, bounded properties pin the
 * invariants assertions must catch (bounds, ordering, dedup, determinism), which
 * is what the scoped mutation manifest then targets.
 */

const STRATEGIES: readonly SelfHealingSuggestionStrategy[] = [
  'testId',
  'roleName',
  'ariaLabel',
  'text',
  'cssFallback',
  'domEvidence',
];

const LOCATOR_POOL: readonly string[] = [
  "page.getByTestId('alpha')",
  "page.getByTestId('beta')",
  "page.getByRole('button', { name: /save/i })",
  "page.getByText('Continue')",
  "page.locator('#gamma')",
];

interface ScoringCase {
  maxCandidates: number;
  failedTarget: string;
  domCandidates: SelfHealingCandidateSeed[];
  registryCandidates: SelectorRegistryEntry[];
}

function generateDomSeed(random: Random, index: number): SelfHealingCandidateSeed {
  return {
    locator: randomFrom(random, LOCATOR_POOL),
    strategy: randomFrom(random, STRATEGIES),
    rationale: `seed-${index}`,
    evidence: {
      elementId: `dom-${index}`,
      source: 'dom',
      uniqueInSnapshot: randomBoolean(random),
      visible: randomBoolean(random),
      accessibleName: randomBoolean(random) ? 'Save changes' : undefined,
      role: randomBoolean(random) ? 'button' : undefined,
      matchedAttributes: ['data-testid'],
    },
  };
}

function generateRegistryEntry(random: Random, index: number): SelectorRegistryEntry {
  const hasConfidence = randomBoolean(random);
  return {
    id: `registry.${index}`,
    pageObjectName: 'CheckoutPage',
    actionType: 'click',
    locator: randomFrom(random, LOCATOR_POOL),
    confidence: hasConfidence ? randomInt(random, 0, 100) / 100 : undefined,
    updatedAt: '2026-06-16T00:00:00.000Z',
    version: index + 1,
  };
}

function generateCase(random: Random): ScoringCase {
  const domCount = randomInt(random, 0, 5);
  const registryCount = randomInt(random, 0, 4);
  return {
    maxCandidates: randomInt(random, 1, 8),
    failedTarget: randomFrom(random, ['#save', '#legacy-save', 'Save changes']),
    domCandidates: Array.from({ length: domCount }, (_, index) => generateDomSeed(random, index)),
    registryCandidates: Array.from({ length: registryCount }, (_, index) =>
      generateRegistryEntry(random, index),
    ),
  };
}

function rank(scoringCase: ScoringCase) {
  return rankSelfHealingCandidates({
    pageObjectName: 'CheckoutPage',
    actionType: 'click',
    failedTarget: scoringCase.failedTarget,
    heuristicSuggestions: [],
    domCandidates: scoringCase.domCandidates,
    registryCandidates: scoringCase.registryCandidates,
    maxCandidates: scoringCase.maxCandidates,
  });
}

describe('rankSelfHealingCandidates properties', () => {
  it('keeps every score finite within [0, 1]', () => {
    forAll({
      seed: 0x5eed01,
      runs: 200,
      generate: generateCase,
      property: (scoringCase) => {
        for (const candidate of rank(scoringCase)) {
          expect(Number.isFinite(candidate.score)).toBe(true);
          expect(candidate.score).toBeGreaterThanOrEqual(0);
          expect(candidate.score).toBeLessThanOrEqual(1);
        }
      },
    });
  });

  it('never returns more than the bounded candidate limit or duplicate locators', () => {
    forAll({
      seed: 0x5eed02,
      runs: 200,
      generate: generateCase,
      property: (scoringCase) => {
        const ranked = rank(scoringCase);
        const boundedLimit = Math.max(1, Math.floor(scoringCase.maxCandidates));
        const uniqueInputLocators = new Set(
          [...scoringCase.domCandidates, ...scoringCase.registryCandidates].map(
            (entry) => entry.locator,
          ),
        );

        expect(ranked.length).toBeLessThanOrEqual(boundedLimit);
        expect(ranked.length).toBeLessThanOrEqual(uniqueInputLocators.size);

        const rankedLocators = ranked.map((candidate) => candidate.locator);
        expect(new Set(rankedLocators).size).toBe(rankedLocators.length);
      },
    });
  });

  it('orders results by descending score then ascending locator', () => {
    forAll({
      seed: 0x5eed03,
      runs: 200,
      generate: generateCase,
      property: (scoringCase) => {
        const ranked = rank(scoringCase);
        for (let index = 1; index < ranked.length; index += 1) {
          const previous = ranked[index - 1];
          const current = ranked[index];
          if (previous.score === current.score) {
            expect(previous.locator.localeCompare(current.locator)).toBeLessThanOrEqual(0);
          } else {
            expect(previous.score).toBeGreaterThan(current.score);
          }
        }
      },
    });
  });

  it('is deterministic for identical inputs', () => {
    forAll({
      seed: 0x5eed04,
      runs: 100,
      generate: generateCase,
      property: (scoringCase) => {
        expect(rank(scoringCase)).toEqual(rank(scoringCase));
      },
    });
  });
});
