import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
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
    });
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
