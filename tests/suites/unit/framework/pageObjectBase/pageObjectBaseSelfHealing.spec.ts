import type { Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageObjectBase } from '../../../../../src/pageObjects/pageObjectBase';

class TestPageObject extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'TestPageObject');
  }
}

type PageMock = {
  click: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  getByLabel: ReturnType<typeof vi.fn>;
  getByRole: ReturnType<typeof vi.fn>;
  getByTestId: ReturnType<typeof vi.fn>;
  getByText: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  textContent: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
};

function createPageMock(): PageMock {
  const locatorMock = {
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnValue({
      isVisible: vi.fn().mockResolvedValue(true),
    }),
  };

  return {
    click: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    getByLabel: vi.fn().mockReturnValue(locatorMock),
    getByRole: vi.fn().mockReturnValue(locatorMock),
    getByTestId: vi.fn().mockReturnValue(locatorMock),
    getByText: vi.fn().mockReturnValue(locatorMock),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    locator: vi.fn().mockReturnValue(locatorMock),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('ok')),
    textContent: vi.fn().mockResolvedValue('text'),
    title: vi.fn().mockResolvedValue('title'),
    url: vi.fn().mockReturnValue('https://example.test/page'),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PageObjectBase self-healing integration', () => {
  let pageMock: PageMock;
  let pageObject: TestPageObject;
  const artifactsDir = path.join(process.cwd(), 'test-results', 'self-healing');

  beforeEach(async () => {
    process.env.SELF_HEAL_MODE = 'suggest';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.95';
    await rm(artifactsDir, { recursive: true, force: true });
    pageMock = createPageMock();
    pageObject = new TestPageObject(pageMock as unknown as Page);
  });

  afterEach(async () => {
    delete process.env.SELF_HEAL_MODE;
    delete process.env.SELF_HEAL_MIN_CONFIDENCE;
    await rm(artifactsDir, { recursive: true, force: true });
  });

  it('captures structured failure context for failed type action', async () => {
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#username', 'alice')).rejects.toThrow(
      'Error typing in selector #username: fill failed',
    );

    const artifacts = await readdir(artifactsDir);
    expect(artifacts).toHaveLength(1);

    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      mode: string;
      pageObjectName: string;
      minConfidence: number;
      action: { type: string; target?: string };
      currentUrl?: string;
      suggestions: Array<{ locator: string; score: number }>;
    };

    expect(content.mode).toBe('suggest');
    expect(content.pageObjectName).toBe('TestPageObject');
    expect(content.minConfidence).toBe(0.95);
    expect(content.currentUrl).toBe('https://example.test/page');
    expect(content.action).toMatchObject({ type: 'type', target: '#username' });
    expect(content.suggestions.length).toBeGreaterThan(0);
    expect(content.suggestions[0]?.score).toBeGreaterThanOrEqual(
      content.suggestions[1]?.score ?? 0,
    );
  });

  it('captures guarded dry-run validation metadata when mode is guarded', async () => {
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#username', 'alice')).rejects.toThrow(
      'Error typing in selector #username: fill failed',
    );

    const artifacts = await readdir(artifactsDir);
    expect(artifacts).toHaveLength(1);

    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      mode: string;
      guardedValidation?: {
        mode: string;
        actionType: string;
        acceptedLocator?: string;
        candidates: Array<{
          locator: string;
          confidenceEligible: boolean;
          status: string;
        }>;
      };
    };

    expect(content.mode).toBe('guarded');
    expect(content.guardedValidation).toBeDefined();
    expect(content.guardedValidation?.mode).toBe('dry-run');
    expect(content.guardedValidation?.actionType).toBe('type');
    expect(content.guardedValidation?.acceptedLocator).toBeTruthy();
    expect(content.guardedValidation?.candidates.length).toBeGreaterThan(0);
    expect(
      content.guardedValidation?.candidates.some((candidate) => candidate.status === 'accepted'),
    ).toBe(true);
  });
});
