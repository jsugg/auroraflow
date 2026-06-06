import type { SelfHealingCandidateSeed } from './candidateTypes';
import type { DomElementSummary, DomSnapshot, SelfHealingActionType } from './types';

export interface DomCandidateExtractionInput {
  snapshot: DomSnapshot;
  actionType: SelfHealingActionType;
  maxTextLength: number;
}

const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test'] as const;
const GENERIC_TEXT_VALUES: ReadonlySet<string> = new Set([
  'button',
  'click',
  'content',
  'form',
  'label',
  'link',
  'menu',
  'navigation',
  'read',
  'text',
]);

function toPlaywrightStringLiteral(value: string): string | null {
  if (value.length === 0) {
    return null;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes('`') && !value.includes('${')) {
    return `\`${value}\``;
  }
  return null;
}

function normalizeText(value: string | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    return null;
  }
  return normalized;
}

function isGenericText(value: string): boolean {
  return GENERIC_TEXT_VALUES.has(value.toLowerCase());
}

function isRoleCompatible(actionType: SelfHealingActionType, role: string): boolean {
  if (actionType === 'type') {
    return ['combobox', 'searchbox', 'spinbutton', 'textbox'].includes(role);
  }
  if (actionType === 'read') {
    return true;
  }
  if (actionType === 'click') {
    return ['button', 'checkbox', 'link', 'menuitem', 'radio', 'switch', 'tab'].includes(role);
  }
  return ['wait', 'screenshot', 'unknown'].includes(actionType);
}

function isTextCandidateAllowed(actionType: SelfHealingActionType, text: string): boolean {
  return (
    ['click', 'read', 'wait', 'unknown'].includes(actionType) &&
    text.length <= 80 &&
    !isGenericText(text)
  );
}

function locatorCountsBy(
  elements: readonly DomElementSummary[],
  keySelector: (element: DomElementSummary) => string | null,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const key = keySelector(element);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function addSeed(
  seeds: Map<string, SelfHealingCandidateSeed>,
  seed: SelfHealingCandidateSeed,
): void {
  if (!seeds.has(seed.locator)) {
    seeds.set(seed.locator, seed);
  }
}

export function extractDomCandidateSeeds({
  snapshot,
  actionType,
  maxTextLength,
}: DomCandidateExtractionInput): SelfHealingCandidateSeed[] {
  const visibleElements = snapshot.elements.filter((element) => element.visible);
  const testIdCounts = locatorCountsBy(visibleElements, (element) => {
    for (const attributeName of TEST_ID_ATTRIBUTES) {
      const value = element.attributes[attributeName];
      if (value) {
        return `${attributeName}:${value}`;
      }
    }
    return null;
  });
  const roleNameCounts = locatorCountsBy(visibleElements, (element) =>
    element.role && element.accessibleName
      ? `${element.role}:${element.accessibleName.toLowerCase()}`
      : null,
  );
  const textCounts = locatorCountsBy(visibleElements, (element) =>
    element.text ? element.text.toLowerCase() : null,
  );
  const cssPathCounts = locatorCountsBy(visibleElements, (element) => element.cssPath ?? null);
  const seeds = new Map<string, SelfHealingCandidateSeed>();

  for (const element of visibleElements) {
    for (const attributeName of TEST_ID_ATTRIBUTES) {
      const testIdValue = element.attributes[attributeName];
      const literal = testIdValue ? toPlaywrightStringLiteral(testIdValue) : null;
      if (!literal) {
        continue;
      }
      const testIdKey = `${attributeName}:${testIdValue}`;
      addSeed(seeds, {
        locator: `page.getByTestId(${literal})`,
        strategy: 'testId',
        rationale: `DOM snapshot exposed a stable ${attributeName} attribute.`,
        evidence: {
          elementId: element.id,
          source: 'dom',
          uniqueInSnapshot: testIdCounts.get(testIdKey) === 1,
          visible: element.visible,
          accessibleName: element.accessibleName,
          role: element.role,
          matchedAttributes: [attributeName],
        },
      });
    }

    const accessibleName = normalizeText(element.accessibleName, maxTextLength);
    const role = element.role;
    if (role && accessibleName && isRoleCompatible(actionType, role)) {
      const literal = toPlaywrightStringLiteral(accessibleName);
      if (literal) {
        const roleNameKey = `${role}:${accessibleName.toLowerCase()}`;
        addSeed(seeds, {
          locator: `page.getByRole('${role}', { name: ${literal} })`,
          strategy: 'roleName',
          rationale: 'DOM snapshot linked the element to a role and accessible name.',
          evidence: {
            elementId: element.id,
            source: 'dom',
            uniqueInSnapshot: roleNameCounts.get(roleNameKey) === 1,
            visible: element.visible,
            accessibleName: accessibleName ?? undefined,
            role,
            matchedAttributes: ['role', 'accessibleName'],
          },
        });
      }
    }

    if (
      accessibleName &&
      (element.attributes['aria-label'] ||
        element.tagName === 'input' ||
        element.tagName === 'textarea')
    ) {
      const literal = toPlaywrightStringLiteral(accessibleName);
      if (literal) {
        addSeed(seeds, {
          locator: `page.getByLabel(${literal})`,
          strategy: 'ariaLabel',
          rationale: 'DOM snapshot found label-compatible accessible name evidence.',
          evidence: {
            elementId: element.id,
            source: 'dom',
            uniqueInSnapshot: true,
            visible: element.visible,
            accessibleName: accessibleName ?? undefined,
            role,
            matchedAttributes: element.attributes['aria-label'] ? ['aria-label'] : ['label'],
          },
        });
      }
    }

    const text = normalizeText(element.text, maxTextLength);
    if (text && isTextCandidateAllowed(actionType, text)) {
      const literal = toPlaywrightStringLiteral(text);
      if (literal) {
        addSeed(seeds, {
          locator: `page.getByText(${literal})`,
          strategy: 'text',
          rationale: 'DOM snapshot found short visible text for the failed action.',
          evidence: {
            elementId: element.id,
            source: 'dom',
            uniqueInSnapshot: textCounts.get(text.toLowerCase()) === 1,
            visible: element.visible,
            accessibleName: accessibleName ?? undefined,
            role,
            matchedAttributes: ['text'],
          },
        });
      }
    }

    const cssLiteral = element.cssPath ? toPlaywrightStringLiteral(element.cssPath) : null;
    if (cssLiteral) {
      addSeed(seeds, {
        locator: `page.locator(${cssLiteral})`,
        strategy: 'cssFallback',
        rationale: 'DOM snapshot supplied a bounded stable CSS fallback path.',
        evidence: {
          elementId: element.id,
          source: 'dom',
          uniqueInSnapshot: cssPathCounts.get(element.cssPath ?? '') === 1,
          visible: element.visible,
          accessibleName: accessibleName ?? undefined,
          role,
          matchedAttributes: ['cssPath'],
        },
      });
    }
  }

  return [...seeds.values()];
}
