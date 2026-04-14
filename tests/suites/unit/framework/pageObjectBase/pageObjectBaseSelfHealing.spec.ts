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
  locatorFirst: {
    click: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    textContent: ReturnType<typeof vi.fn>;
    waitFor: ReturnType<typeof vi.fn>;
    elementHandle: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
  };
};

function createPageMock(): PageMock {
  const locatorFirst = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    textContent: vi.fn().mockResolvedValue('healed text'),
    waitFor: vi.fn().mockResolvedValue(undefined),
    elementHandle: vi.fn().mockResolvedValue(null),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const locatorMock = {
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnValue(locatorFirst),
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
    locatorFirst,
  };
}

describe('PageObjectBase self-healing integration', () => {
  let pageMock: PageMock;
  let pageObject: TestPageObject;
  const artifactsDir = path.join(process.cwd(), 'test-results', 'self-healing');

  beforeEach(async () => {
    process.env.AURORAFLOW_RUN_ID = 'local-run';
    process.env.SELF_HEAL_MODE = 'suggest';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.95';
    delete process.env.SELF_HEAL_ALLOWED_ACTIONS;
    delete process.env.SELF_HEAL_ALLOWED_DOMAINS;
    await rm(artifactsDir, { recursive: true, force: true });
    pageMock = createPageMock();
    pageObject = new TestPageObject(pageMock as unknown as Page);
  });

  afterEach(async () => {
    delete process.env.AURORAFLOW_RUN_ID;
    delete process.env.SELF_HEAL_MODE;
    delete process.env.SELF_HEAL_MIN_CONFIDENCE;
    delete process.env.SELF_HEAL_ALLOWED_ACTIONS;
    delete process.env.SELF_HEAL_ALLOWED_DOMAINS;
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
      component: string;
      runId: string;
      errorCode: string;
      minConfidence: number;
      safetyPolicy: {
        allowedActions: string[];
        allowedDomains: string[];
      };
      action: { type: string; target?: string };
      currentUrl?: string;
      suggestions: Array<{ locator: string; score: number }>;
    };

    expect(content.mode).toBe('suggest');
    expect(content.pageObjectName).toBe('TestPageObject');
    expect(content.component).toBe('TestPageObject');
    expect(content.runId).toBe('local-run');
    expect(content.errorCode).toBe('page_action_type_failed');
    expect(content.minConfidence).toBe(0.95);
    expect(content.safetyPolicy).toEqual({
      allowedActions: ['click', 'type', 'read', 'wait', 'screenshot'],
      allowedDomains: [],
    });
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
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'type,click';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.fill.mockRejectedValueOnce(new Error('fill failed'));

    await expect(pageObject.type('#username', 'alice')).resolves.toBeNull();

    const artifacts = await readdir(artifactsDir);
    expect(artifacts).toHaveLength(1);

    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      mode: string;
      guardedValidation?: {
        mode: string;
        actionType: string;
        acceptedLocator?: string;
        policy: {
          actionAllowed: boolean;
          domainAllowed: boolean;
          evaluatedDomain?: string;
          allowedActions: string[];
          allowedDomains: string[];
        };
        candidates: Array<{
          locator: string;
          confidenceEligible: boolean;
          status: string;
        }>;
      };
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        locator?: string;
      };
    };

    expect(content.mode).toBe('guarded');
    expect(content.guardedValidation).toBeDefined();
    expect(content.guardedValidation?.mode).toBe('dry-run');
    expect(content.guardedValidation?.actionType).toBe('type');
    expect(content.guardedValidation?.acceptedLocator).toBeTruthy();
    expect(content.guardedValidation?.policy).toMatchObject({
      actionAllowed: true,
      domainAllowed: true,
      evaluatedDomain: 'example.test',
      allowedActions: ['type', 'click'],
      allowedDomains: ['example.test'],
    });
    expect(content.guardedValidation?.candidates.length).toBeGreaterThan(0);
    expect(
      content.guardedValidation?.candidates.some((candidate) => candidate.status === 'accepted'),
    ).toBe(true);
    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: true,
    });
  });

  it('auto-applies accepted guarded click candidates and records success in artifact', async () => {
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));

    await expect(pageObject.click('#submit')).resolves.toBeNull();
    expect(pageMock.locatorFirst.click).toHaveBeenCalledTimes(1);

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        locator?: string;
      };
    };

    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: true,
    });
    expect(content.guardedAutoHeal?.locator).toBeTruthy();
  });

  it('records guarded auto-heal apply failures without swallowing the original action error', async () => {
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'example.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));
    pageMock.locatorFirst.click.mockRejectedValueOnce(new Error('healed click failed'));

    await expect(pageObject.click('#submit')).rejects.toThrow(
      'Error clicking on selector #submit: click failed',
    );

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        errorMessage?: string;
      };
    };

    expect(content.guardedAutoHeal).toMatchObject({
      attempted: true,
      succeeded: false,
    });
    expect(content.guardedAutoHeal?.errorMessage).toContain('healed click failed');
  });

  it('skips guarded auto-heal application when policy blocks candidate validation', async () => {
    process.env.SELF_HEAL_MODE = 'guarded';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.3';
    process.env.SELF_HEAL_ALLOWED_ACTIONS = 'click,type';
    process.env.SELF_HEAL_ALLOWED_DOMAINS = 'allowed.test';
    pageMock.click.mockRejectedValueOnce(new Error('click failed'));

    await expect(pageObject.click('#submit')).rejects.toThrow(
      'Error clicking on selector #submit: click failed',
    );

    expect(pageMock.locatorFirst.click).not.toHaveBeenCalled();

    const artifacts = await readdir(artifactsDir);
    const artifactPath = path.join(artifactsDir, artifacts[0]);
    const content = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      guardedValidation?: {
        policy: {
          blockedReason?: string;
        };
      };
      guardedAutoHeal?: {
        attempted: boolean;
        succeeded: boolean;
        skippedReason?: string;
      };
    };

    expect(content.guardedValidation?.policy.blockedReason).toBe('domain_not_allowed');
    expect(content.guardedAutoHeal).toMatchObject({
      attempted: false,
      succeeded: false,
      skippedReason: 'no_accepted_locator',
    });
  });
});
