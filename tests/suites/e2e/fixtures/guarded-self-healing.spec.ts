import { expect, test, type Page } from '@playwright/test';
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
import {
  SELF_HEALING_ARTIFACT_ENV_KEYS,
  createPlaywrightSelfHealingArtifactScope,
  readSelfHealingArtifactFor,
  type SelfHealingArtifactScope,
} from '../../../helpers/selfHealingArtifacts';
import { CapturingTelemetry } from '../../unit/framework/observability/capturingTelemetry';
import { FixtureSelfHealingPage } from './fixtureApp';

// `page.evaluate` callbacks execute in the browser; declare the globals they
// reference so this Node-typed spec typechecks without pulling in the DOM lib.
declare const window: { dispatchEvent(event: unknown): boolean };
declare const Event: new (type: string) => unknown;

// Parallel proof validates guarded recovery, not a sub-second click budget.
const GUARDED_ACTION_TIMEOUT_MS = 3_000;

test.setTimeout(90_000);

// The framework resolves self-healing config and correlation identifiers from
// `process.env` (PageObjectBase reads it directly), so these tests drive the
// real config path by setting process.env and restoring it per test — the same
// pattern as tests/suites/e2e/examples/self-healing-sat.spec.ts. The registry runtime is supplied through the existing
// `resolveRegistryRuntime` override seam on FixtureSelfHealingPage.
const SELF_HEAL_ENV_KEYS = [
  ...SELF_HEALING_ARTIFACT_ENV_KEYS,
  'SELF_HEAL_MODE',
  'SELF_HEAL_MIN_CONFIDENCE',
  'SELF_HEAL_ALLOWED_ACTIONS',
  'SELF_HEAL_ALLOWED_DOMAINS',
  'SELF_HEAL_MAX_CANDIDATES',
  'SELF_HEAL_MAX_DOM_NODES',
  'SELF_HEAL_SAT_CAPTURE_DOM',
  'SELF_HEAL_SAT_ENABLED',
] as const;

let previousEnv: Map<(typeof SELF_HEAL_ENV_KEYS)[number], string | undefined> | undefined;
let artifactScope: SelfHealingArtifactScope | undefined;

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

function currentArtifactScope(): SelfHealingArtifactScope {
  if (artifactScope === undefined) {
    throw new Error('Self-healing artifact scope was not initialized for this test.');
  }
  return artifactScope;
}

function createGuardedEnv(scope: SelfHealingArtifactScope): Record<string, string | undefined> {
  return {
    ...scope.env,
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

async function readArtifactFor(scope: SelfHealingArtifactScope): Promise<GuardedArtifact> {
  return readSelfHealingArtifactFor<GuardedArtifact>(scope);
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

test.describe.configure({ mode: 'parallel' });

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  previousEnv = new Map(SELF_HEAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of SELF_HEAL_ENV_KEYS) {
    delete process.env[key];
  }
  artifactScope = await createPlaywrightSelfHealingArtifactScope(testInfo, {
    prefix: 'guarded-self-healing',
  });
});

test.afterEach(async () => {
  if (previousEnv !== undefined) {
    for (const key of SELF_HEAL_ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
  resetTelemetryForTests();
  artifactScope = undefined;
  previousEnv = undefined;
});

test('guarded self-heal auto-applies registry candidate at default 0.92', async ({ page }) => {
  const telemetry = new CapturingTelemetry();
  setTelemetryForTests(telemetry);
  const scope = currentArtifactScope();
  const env = createGuardedEnv(scope);
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
  const artifact = await readArtifactFor(scope);

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
  const scope = currentArtifactScope();
  const env = createGuardedEnv(scope);
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

  const artifact = await readArtifactFor(scope);
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
  const env = createGuardedEnv(currentArtifactScope());
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
  const env = createGuardedEnv(currentArtifactScope());
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

// Frame-aware structured candidates (AUR-QE-112) let guarded validation resolve a
// `page.frameLocator(...).getByTestId(...)` registry candidate structurally: the
// registry locator string is converted to a structured frame candidate at read
// time (candidateScoring -> parseLegacyLocatorString), so both the guarded dry-run
// and the auto-apply enter the same-origin iframe without parsing display strings.
// Previously skipped as a known limitation; now a first-class recovery proof.
test('guarded self-heal recovers same-origin iframe fixture by effect', async ({ page }) => {
  const env = createGuardedEnv(currentArtifactScope());
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
