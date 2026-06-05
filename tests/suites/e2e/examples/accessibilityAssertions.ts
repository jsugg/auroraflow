import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const ACCESSIBILITY_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AccessibilityViolation = AxeResults['violations'][number];

interface AccessibilityViolationSummary {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  targets: string[];
}

function serializeTarget(target: unknown): string {
  if (!Array.isArray(target)) {
    return String(target);
  }

  return target.map((entry) => serializeTarget(entry)).join(' > ');
}

function summarizeViolations(
  violations: readonly AccessibilityViolation[],
): AccessibilityViolationSummary[] {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    helpUrl: violation.helpUrl,
    targets: violation.nodes.map((node) => serializeTarget(node.target)),
  }));
}

export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .setLegacyMode(true)
    .withTags([...ACCESSIBILITY_TAGS])
    .analyze();

  expect(summarizeViolations(results.violations)).toEqual([]);
}
