import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SELF_HEAL_MIN_CONFIDENCE } from '../../../../src/framework/selfHealing/config';
import {
  resetTelemetryForTests,
  setTelemetryForTests,
} from '../../../../src/framework/observability/telemetry';
import { METRIC_NAMES } from '../../../../src/framework/observability/metricNames';
import type {
  SelectorRegistryEntry,
  SelfHealingRegistryRuntime,
} from '../../../../src/framework/selfHealing/registryContracts';
import { CapturingTelemetry } from '../../unit/framework/observability/capturingTelemetry';
import { FixtureSelfHealingPage } from './fixtureApp';

// `page.evaluate` callbacks execute in the browser; declare the globals they
// reference so this Node-typed spec typechecks without pulling in the DOM lib.
declare const window: { dispatchEvent(event: unknown): boolean };
declare const Event: new (type: string) => unknown;

const ARTIFACTS_DIR = path.join(process.cwd(), 'test-results', 'self-healing');
const GUARDED_ACTION_TIMEOUT_MS = 2_000;

// The framework resolves self-healing config and correlation identifiers from
// `process.env` (PageObjectBase reads it directly), so these tests drive the
// real config path by setting process.env and restoring it per test — the same
// pattern as tests/suites/e2e/examples/self-healing-sat.spec.ts. No production
// code is modified; the registry runtime is supplied through the existing
// `resolveRegistryRuntime` override seam on FixtureSelfHealingPage.
const SELF_HEAL_ENV_KEYS = [
  'AURORAFLOW_RUN_ID',
  'AURORAFLOW_TEST_ID',
  'SELF_HEAL_MODE',
  'SELF_HEAL_MIN_CONFIDENCE',
  'SELF_HEAL_ALLOWED_ACTIONS',
  'SELF_HEAL_ALLOWED_DOMAINS',
  'SELF_HEAL_MAX_CANDIDATES',
  'SELF_HEAL_MAX_DOM_NODES',
  'SELF_HEAL_SAT_CAPTURE_DOM',
  'SELF_HEAL_SAT_ENABLED',
] as const;

let previousEnv: Map<(typeof SELF_HEAL_ENV_KEYS)[number], string | undefined>;

function applyGuardedEnv(env: Readonly<Record<string, string | undefined>>): void {
  for (const key of SELF_HEAL_ENV_KEYS) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

interface GuardedArtifact {
  mode: string;
  runId: string;
  testId?: string;
  minConfidence: number;
  action: {
    selectorId?: string;
    target?: string;
    type: string;
  };
  sat?: {
    candidates: Array<{
      evidence: {
        source: string;
      };
      locator: string;
      registryRecordId?: string;
      registryRecordVersion?: number;
      score: number;
      strategy: string;
    }>;
  };
  guardedValidation?: {
    acceptedLocator?: string;
    acceptedScore?: number;
    candidates: Array<{
      confidenceEligible: boolean;
      locator: string;
      score: number;
      status: string;
    }>;
  };
  guardedAutoHeal?: {
    attempted: boolean;
    locator?: string;
    skippedReason?: string;
    succeeded: boolean;
  };
}

function createGuardedEnv(testId: string): Record<string, string | undefined> {
  return {
    AURORAFLOW_RUN_ID: `guarded-e2e-${testId}`,
    AURORAFLOW_TEST_ID: testId,
    SELF_HEAL_MODE: 'guarded',
    SELF_HEAL_ALLOWED_ACTIONS: 'click,type,read,wait',
    SELF_HEAL_ALLOWED_DOMAINS: '127.0.0.1,localhost',
    SELF_HEAL_MAX_CANDIDATES: '12',
    SELF_HEAL_MAX_DOM_NODES: '250',
    SELF_HEAL_SAT_CAPTURE_DOM: 'true',
    SELF_HEAL_SAT_ENABLED: 'true',
  };
}

function registryRuntime(entry: SelectorRegistryEntry): SelfHealingRegistryRuntime {
  return {
    selectors: {
      get: async (selectorId: string) => (selectorId === entry.id ? entry : null),
      findCandidates: async () => [entry],
    },
    histories: {
      get: async () => null,
      getMany: async () => new Map(),
    },
    promotions: {
      get: async () => null,
      list: async () => [],
      upsert: async (promotion) => promotion,
    },
    required: false,
  };
}

function registryEntry(input: {
  id: string;
  locator: string;
  pageObjectName?: string;
}): SelectorRegistryEntry {
  return {
    id: input.id,
    pageObjectName: input.pageObjectName ?? 'FixtureSelfHealingPage',
    actionType: 'click',
    locator: input.locator,
    confidence: 0.94,
    strategy: 'registry',
    updatedAt: '2026-06-16T00:00:00.000Z',
    version: 1,
  };
}

async function readArtifactFor(
  env: Readonly<Record<string, string | undefined>>,
): Promise<GuardedArtifact> {
  const files = await readdir(ARTIFACTS_DIR).catch(() => []);
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const artifact = JSON.parse(
      await readFile(path.join(ARTIFACTS_DIR, file), 'utf8'),
    ) as GuardedArtifact;
    if (artifact.runId === env.AURORAFLOW_RUN_ID && artifact.testId === env.AURORAFLOW_TEST_ID) {
      return artifact;
    }
  }
  throw new Error(`No guarded self-healing artifact found for ${env.AURORAFLOW_TEST_ID}.`);
}

async function runGuardedClick({
  env,
  page,
  record,
  selectorId,
  staleSelector,
}: {
  env: Readonly<Record<string, string | undefined>>;
  page: Page;
  record: SelectorRegistryEntry;
  selectorId: string;
  staleSelector: string;
}): Promise<void> {
  applyGuardedEnv(env);
  const pageObject = new FixtureSelfHealingPage(page, registryRuntime(record));
  await pageObject.openFixture();
  await pageObject.click(staleSelector, { selectorId, timeout: GUARDED_ACTION_TIMEOUT_MS });
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  previousEnv = new Map(SELF_HEAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of SELF_HEAL_ENV_KEYS) {
    delete process.env[key];
  }
  await rm(ARTIFACTS_DIR, { recursive: true, force: true });
});

test.afterEach(async () => {
  for (const key of SELF_HEAL_ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetTelemetryForTests();
  await rm(ARTIFACTS_DIR, { recursive: true, force: true });
});

test('guarded self-heal auto-applies registry candidate at default 0.92', async ({ page }) => {
  const telemetry = new CapturingTelemetry();
  setTelemetryForTests(telemetry);
  const env = createGuardedEnv('default-gate');
  expect(env.SELF_HEAL_MIN_CONFIDENCE).toBeUndefined();
  const acceptedLocator = "page.getByTestId('guarded-submit')";

  await runGuardedClick({
    env,
    page,
    record: registryEntry({ id: 'checkout.submit.guarded', locator: acceptedLocator }),
    selectorId: 'checkout.submit.guarded',
    staleSelector: '#legacy-guarded-submit',
  });

  await expect(page.locator('#guarded-status')).toHaveText('Guarded order submitted');
  const artifact = await readArtifactFor(env);

  expect(artifact.minConfidence).toBe(DEFAULT_SELF_HEAL_MIN_CONFIDENCE);
  expect(artifact.guardedValidation?.acceptedLocator).toBe(acceptedLocator);
  expect(artifact.guardedValidation?.acceptedScore).toBeGreaterThanOrEqual(
    DEFAULT_SELF_HEAL_MIN_CONFIDENCE,
  );
  expect(artifact.guardedAutoHeal).toMatchObject({
    attempted: true,
    locator: acceptedLocator,
    succeeded: true,
  });
  expect(artifact.sat?.candidates[0]).toMatchObject({
    evidence: { source: 'registry' },
    locator: acceptedLocator,
    registryRecordId: 'checkout.submit.guarded',
    strategy: 'registry',
  });
  expect(telemetry.counters).toContainEqual({
    name: METRIC_NAMES.guardedAutoHealTotal,
    value: 1,
    attributes: {
      'auroraflow.action.type': 'click',
      'auroraflow.self_heal.status': 'succeeded',
    },
  });
});

test('guarded self-heal rejects fresh DOM candidates at default 0.92', async ({ page }) => {
  const env = createGuardedEnv('fresh-dom-rejected');
  applyGuardedEnv(env);
  const pageObject = new FixtureSelfHealingPage(page);
  await pageObject.openFixture();

  await expect(
    pageObject.click('#legacy-guarded-submit', {
      selectorId: 'checkout.submit.unseeded',
      timeout: GUARDED_ACTION_TIMEOUT_MS,
    }),
  ).rejects.toThrow('Error clicking on selector #legacy-guarded-submit');
  await expect(page.locator('#guarded-status')).toHaveText('Waiting for guarded action');

  const artifact = await readArtifactFor(env);
  expect(artifact.minConfidence).toBe(DEFAULT_SELF_HEAL_MIN_CONFIDENCE);
  expect(artifact.guardedValidation?.acceptedLocator).toBeUndefined();
  expect(
    artifact.guardedValidation?.candidates.some((candidate) => candidate.confidenceEligible),
  ).toBe(false);
  expect(artifact.guardedAutoHeal).toMatchObject({
    attempted: false,
    skippedReason: 'no_accepted_locator',
    succeeded: false,
  });
});

test('guarded self-heal recovers dynamic re-render fixture by effect', async ({ page }) => {
  const env = createGuardedEnv('dynamic-rerender');
  applyGuardedEnv(env);
  const pageObject = new FixtureSelfHealingPage(
    page,
    registryRuntime(
      registryEntry({
        id: 'checkout.submit.dynamic',
        locator: "page.getByTestId('dynamic-submit')",
      }),
    ),
  );
  await pageObject.openFixture();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('auroraflow:rerender-dynamic'));
  });
  await pageObject.click('#legacy-dynamic-submit', {
    selectorId: 'checkout.submit.dynamic',
    timeout: GUARDED_ACTION_TIMEOUT_MS,
  });

  await expect(page.locator('#dynamic-status')).toHaveText('Dynamic order submitted');
});

test('guarded self-heal recovers open shadow DOM fixture by effect', async ({ page }) => {
  const env = createGuardedEnv('shadow-dom');
  await runGuardedClick({
    env,
    page,
    record: registryEntry({
      id: 'checkout.submit.shadow',
      locator: 'page.locator(\'shadow-checkout [data-testid="shadow-submit"]\')',
    }),
    selectorId: 'checkout.submit.shadow',
    staleSelector: '#legacy-shadow-submit',
  });

  await expect(page.locator('#shadow-status')).toHaveText('Shadow order submitted');
});

// KNOWN LIMITATION: guarded validation resolves candidate locators via
// resolveLocatorExpression (src/framework/selfHealing/guardedValidation.ts),
// which supports getByTestId/getByText/getByLabel/getByRole/locator but NOT
// page.frameLocator(...). A cross-iframe candidate can therefore never be
// accepted or auto-applied today, so this scenario cannot pass against the
// current framework. Tracked by the structured-candidate work (AUR-IMPL-020).
// Kept as a fixme so the gap is visible and re-enabled when frame-aware
// candidates land — not deleted, and not patched in src under this test-only scope.
test.fixme('guarded self-heal recovers same-origin iframe fixture by effect', async ({ page }) => {
  const env = createGuardedEnv('iframe');
  await runGuardedClick({
    env,
    page,
    record: registryEntry({
      id: 'checkout.submit.iframe',
      locator:
        "page.frameLocator('iframe[title=\"Checkout iframe\"]').getByTestId('iframe-submit')",
    }),
    selectorId: 'checkout.submit.iframe',
    staleSelector: '#legacy-iframe-submit',
  });

  await expect(page.locator('#iframe-status')).toHaveText('Iframe order submitted');
});
