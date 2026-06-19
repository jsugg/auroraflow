import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { SENSITIVE_ARTIFACT_PRIVACY_POLICY } from '../../../../../src/framework/selfHealing/artifactPrivacy';
import {
  captureDomSnapshot,
  normalizeAllowedAttributes,
  normalizeDomText,
  redactDomAttributeValue,
  summarizeDomSnapshot,
} from '../../../../../src/framework/selfHealing/domSnapshot';
import type { DomSnapshot } from '../../../../../src/framework/selfHealing/types';

describe('domSnapshot utilities', () => {
  it('normalizes text and attribute allow-lists deterministically', () => {
    expect(normalizeDomText('  Submit\n\n order  ', 20)).toBe('Submit order');
    expect(normalizeDomText('abcdefghijklmnopqrstuvwxyz', 8)).toBe('abcdefgh');
    expect(normalizeAllowedAttributes([' DATA-TestId ', 'data-testid', 'ARIA-LABEL'])).toEqual([
      'data-testid',
      'aria-label',
    ]);
  });

  it('redacts sensitive attributes and form values', () => {
    expect(
      redactDomAttributeValue({
        attributeName: 'data-api-key',
        attributeValue: 'secret-value',
        tagName: 'div',
      }),
    ).toBe('[redacted]');
    expect(
      redactDomAttributeValue({
        attributeName: 'value',
        attributeValue: 'typed secret',
        tagName: 'input',
      }),
    ).toBe('[redacted]');
  });

  it('passes bounded normalized options into the browser snapshot evaluator', async () => {
    const expectedSnapshot = {
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-05T12:00:00.000Z',
      url: 'https://example.test',
      nodeCount: 1,
      truncated: false,
      elements: [],
    } satisfies DomSnapshot;
    const evaluate = vi
      .fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>()
      .mockResolvedValue(expectedSnapshot);
    const page = { evaluate } as unknown as Page;

    const snapshot = await captureDomSnapshot(page, {
      capturedAt: expectedSnapshot.capturedAt,
      currentUrl: expectedSnapshot.url,
      maxDomNodes: 2.7,
      maxTextLength: 80.2,
      allowedAttributes: [' DATA-TestId ', 'data-testid'],
    });

    expect(snapshot).toEqual(expectedSnapshot);
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), {
      capturedAt: expectedSnapshot.capturedAt,
      currentUrl: expectedSnapshot.url,
      maxDomNodes: 2,
      maxTextLength: 80,
      allowedAttributes: ['data-testid'],
      domTextMode: 'capture',
    });
  });

  it('requests in-browser text omission for the sensitive preset', async () => {
    const expectedSnapshot = {
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-05T12:00:00.000Z',
      nodeCount: 0,
      truncated: false,
      elements: [],
    } satisfies DomSnapshot;
    const evaluate = vi
      .fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>()
      .mockResolvedValue(expectedSnapshot);
    const page = { evaluate } as unknown as Page;
    await captureDomSnapshot(page, {
      maxDomNodes: 10,
      maxTextLength: 80,
      allowedAttributes: ['aria-label'],
      privacyPolicy: SENSITIVE_ARTIFACT_PRIVACY_POLICY,
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ domTextMode: 'disable' }),
    );
  });

  it('summarizes snapshots without embedding element payloads', () => {
    const snapshot = {
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-05T12:00:00.000Z',
      nodeCount: 2,
      truncated: true,
      elements: [
        {
          id: 'dom-1',
          tagName: 'button',
          attributes: {},
          visible: true,
          depth: 1,
          childCount: 0,
        },
      ],
    } satisfies DomSnapshot;

    expect(summarizeDomSnapshot(snapshot, 'test-results/self-healing/event.dom.json')).toEqual({
      schemaVersion: '1.0.0',
      capturedAt: snapshot.capturedAt,
      url: undefined,
      nodeCount: 2,
      truncated: true,
      elementCount: 1,
      artifactPath: 'test-results/self-healing/event.dom.json',
    });
  });
});

describe('domSnapshot node-reachable helpers (AUR-QE-109)', () => {
  it('redacts every sensitive attribute name pattern', () => {
    for (const attributeName of [
      'data-password',
      'x-token',
      'client-secret',
      'api-key',
      'authorization',
      'cookie',
      'session-id',
    ]) {
      expect(
        redactDomAttributeValue({ attributeName, attributeValue: 'leak', tagName: 'div' }),
      ).toBe('[redacted]');
    }
  });

  it('passes through non-sensitive attributes and form values on non-input tags', () => {
    expect(
      redactDomAttributeValue({
        attributeName: 'data-testid',
        attributeValue: 'login',
        tagName: 'button',
      }),
    ).toBe('login');
    expect(
      redactDomAttributeValue({
        attributeName: 'value',
        attributeValue: 'visible',
        tagName: 'div',
      }),
    ).toBe('visible');
  });

  it('deduplicates and lowercases the attribute allow-list while dropping blanks', () => {
    expect(normalizeAllowedAttributes(['  ', 'ID', 'id', ' Data-Test '])).toEqual([
      'id',
      'data-test',
    ]);
  });

  it('returns collapsed text unchanged when within the length budget', () => {
    expect(normalizeDomText('already short', 50)).toBe('already short');
  });

  it('defaults capturedAt, omits url, and applies the default privacy policy', async () => {
    const evaluated = {
      schemaVersion: '1.0.0',
      capturedAt: '2026-06-05T12:00:00.000Z',
      nodeCount: 0,
      truncated: false,
      elements: [],
    } satisfies DomSnapshot;
    const evaluate = vi
      .fn<(_: unknown, input: unknown) => Promise<DomSnapshot>>()
      .mockResolvedValue(evaluated);
    const page = { evaluate } as unknown as Page;

    await captureDomSnapshot(page, {
      maxDomNodes: 0,
      maxTextLength: 1,
      allowedAttributes: ['id'],
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        currentUrl: undefined,
        maxDomNodes: 1,
        maxTextLength: 1,
        domTextMode: 'capture',
      }),
    );
    const passedInput = evaluate.mock.calls[0]?.[1] as { capturedAt: string };
    expect(typeof passedInput.capturedAt).toBe('string');
    expect(passedInput.capturedAt.length).toBeGreaterThan(0);
  });
});
