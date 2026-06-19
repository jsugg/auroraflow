import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { extractDomCandidateSeeds } from '../../../../../src/framework/selfHealing/domCandidateExtraction';
import { resolveLocatorExpression } from '../../../../../src/framework/selfHealing/guardedValidation';
import type { DomSnapshot } from '../../../../../src/framework/selfHealing/types';

const snapshot: DomSnapshot = {
  schemaVersion: '1.0.0',
  capturedAt: '2026-06-05T12:00:00.000Z',
  url: 'https://example.test',
  nodeCount: 3,
  truncated: false,
  elements: [
    {
      id: 'dom-1',
      tagName: 'button',
      attributes: {
        'data-testid': 'submit-order',
        id: 'submit',
        type: 'button',
      },
      role: 'button',
      accessibleName: 'Submit order',
      text: 'Submit order',
      visible: true,
      enabled: true,
      editable: false,
      depth: 4,
      childCount: 0,
      cssPath: 'button#submit',
    },
    {
      id: 'dom-2',
      tagName: 'p',
      attributes: {},
      text: 'button',
      visible: true,
      enabled: true,
      editable: false,
      depth: 4,
      childCount: 0,
      cssPath: 'p.helper',
    },
  ],
};

describe('extractDomCandidateSeeds', () => {
  it('extracts stable DOM-backed candidates and filters generic text', () => {
    const candidates = extractDomCandidateSeeds({
      snapshot,
      actionType: 'click',
      maxTextLength: 120,
    });

    expect(candidates.map((candidate) => candidate.locator)).toEqual(
      expect.arrayContaining([
        "page.getByTestId('submit-order')",
        "page.getByRole('button', { name: 'Submit order' })",
        "page.getByText('Submit order')",
        "page.locator('button#submit')",
      ]),
    );
    expect(candidates.some((candidate) => candidate.locator === "page.getByText('button')")).toBe(
      false,
    );
    expect(
      candidates.find((candidate) => candidate.locator === "page.getByTestId('submit-order')")
        ?.evidence.uniqueInSnapshot,
    ).toBe(true);
  });

  it('attaches structured candidate locators to each DOM seed (AUR-IMPL-020)', () => {
    const candidates = extractDomCandidateSeeds({
      snapshot,
      actionType: 'click',
      maxTextLength: 120,
    });
    const byLocator = new Map(
      candidates.map((candidate) => [candidate.locator, candidate.candidateLocator]),
    );

    expect(byLocator.get("page.getByTestId('submit-order')")).toEqual({
      schemaVersion: '1.0.0',
      kind: 'testId',
      value: 'submit-order',
    });
    expect(byLocator.get("page.getByRole('button', { name: 'Submit order' })")).toEqual({
      schemaVersion: '1.0.0',
      kind: 'role',
      role: 'button',
      name: { kind: 'string', value: 'Submit order' },
    });
    expect(byLocator.get("page.getByText('Submit order')")).toEqual({
      schemaVersion: '1.0.0',
      kind: 'text',
      value: 'Submit order',
    });
    expect(byLocator.get("page.locator('button#submit')")).toEqual({
      schemaVersion: '1.0.0',
      kind: 'css',
      selector: 'button#submit',
    });
  });

  it('emits quoted role, label, text, and CSS locators parseable until AUR-IMPL-020', () => {
    const quotedSnapshot: DomSnapshot = {
      ...snapshot,
      elements: [
        {
          id: 'dom-quote',
          tagName: 'button',
          attributes: {
            'aria-label': "It's saved",
          },
          role: 'button',
          accessibleName: "It's saved",
          text: "It's saved",
          visible: true,
          enabled: true,
          editable: false,
          depth: 4,
          childCount: 0,
          cssPath: 'button[aria-label="It\'s saved"]',
        },
      ],
    };
    const locatorMock = {};
    const pageMock = {
      getByLabel: vi.fn().mockReturnValue(locatorMock),
      getByRole: vi.fn().mockReturnValue(locatorMock),
      getByTestId: vi.fn().mockReturnValue(locatorMock),
      getByText: vi.fn().mockReturnValue(locatorMock),
      locator: vi.fn().mockReturnValue(locatorMock),
    };

    const candidates = extractDomCandidateSeeds({
      snapshot: quotedSnapshot,
      actionType: 'click',
      maxTextLength: 120,
    });
    const locators = candidates.map((candidate) => candidate.locator);
    for (const locator of locators) {
      expect(resolveLocatorExpression(pageMock as unknown as Page, locator)).not.toBeNull();
    }

    expect(locators).toEqual(
      expect.arrayContaining([
        "page.getByRole('button', { name: \"It's saved\" })",
        'page.getByLabel("It\'s saved")',
        'page.getByText("It\'s saved")',
        'page.locator(`button[aria-label="It\'s saved"]`)',
      ]),
    );
    expect(pageMock.getByRole).toHaveBeenCalledWith('button', { name: "It's saved" });
    expect(pageMock.getByLabel).toHaveBeenCalledWith("It's saved");
    expect(pageMock.getByText).toHaveBeenCalledWith("It's saved");
    expect(pageMock.locator).toHaveBeenCalledWith('button[aria-label="It\'s saved"]');
  });
});
