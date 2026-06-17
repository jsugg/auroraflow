import { expect, test, type Page } from '@playwright/test';
import { PageObjectBase } from '../../../../src/pageObjects/pageObjectBase';
import {
  SELF_HEALING_ARTIFACT_ENV_KEYS,
  applySelfHealingArtifactScopeEnv,
  createPlaywrightSelfHealingArtifactScope,
  readSelfHealingArtifactFor,
} from '../../../helpers/selfHealingArtifacts';

class SelfHealingSatFixturePage extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'SelfHealingSatFixturePage');
  }
}

const ENV_KEYS = [
  ...SELF_HEALING_ARTIFACT_ENV_KEYS,
  'SELF_HEAL_MODE',
  'SELF_HEAL_MIN_CONFIDENCE',
  'SELF_HEAL_SAT_ENABLED',
  'SELF_HEAL_SAT_CAPTURE_DOM',
  'SELF_HEAL_MAX_DOM_NODES',
  'SELF_HEAL_MAX_CANDIDATES',
  'SELF_HEAL_ALLOWED_DOMAINS',
] as const;

function captureEnv(): Map<(typeof ENV_KEYS)[number], string | undefined> {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: ReadonlyMap<(typeof ENV_KEYS)[number], string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = values.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test('self-healing SAT enriches a deterministic failed page-object action', async ({
  page,
}, testInfo) => {
  const previousEnv = captureEnv();
  const artifactScope = await createPlaywrightSelfHealingArtifactScope(testInfo, {
    prefix: 'self-healing-sat',
  });
  try {
    applySelfHealingArtifactScopeEnv(artifactScope);
    process.env.SELF_HEAL_MODE = 'suggest';
    process.env.SELF_HEAL_MIN_CONFIDENCE = '0.9';
    process.env.SELF_HEAL_SAT_ENABLED = 'true';
    process.env.SELF_HEAL_SAT_CAPTURE_DOM = 'true';
    process.env.SELF_HEAL_MAX_DOM_NODES = '50';
    process.env.SELF_HEAL_MAX_CANDIDATES = '10';
    delete process.env.SELF_HEAL_ALLOWED_DOMAINS;

    await page.setContent(`
      <main>
        <form aria-label="Checkout">
          <button id="submit-order" data-testid="submit-order" type="button">
            Submit order
          </button>
        </form>
      </main>
    `);

    const fixturePage = new SelfHealingSatFixturePage(page);
    await expect(fixturePage.click('#missing-submit', { timeout: 250 })).rejects.toThrow(
      'Error clicking on selector #missing-submit',
    );

    const artifact = await readSelfHealingArtifactFor<{
      runId?: string;
      testId?: string;
      sat?: {
        enabled: boolean;
        snapshot?: {
          elementCount: number;
          truncated: boolean;
        };
        candidates: Array<{
          locator: string;
          strategy: string;
          evidence: {
            source: string;
          };
        }>;
      };
    }>(artifactScope);

    expect(artifact.sat).toBeDefined();
    expect(artifact.sat?.enabled).toBe(true);
    expect(artifact.sat?.snapshot).toMatchObject({
      elementCount: expect.any(Number),
      truncated: false,
    });
    expect(artifact.sat?.snapshot?.elementCount).toBeGreaterThan(0);
    expect(artifact.sat?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: "page.getByTestId('submit-order')",
          strategy: 'testId',
          evidence: expect.objectContaining({
            source: 'dom',
          }),
        }),
      ]),
    );
  } finally {
    restoreEnv(previousEnv);
  }
});
