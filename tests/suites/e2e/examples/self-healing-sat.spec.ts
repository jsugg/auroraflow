import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { PageObjectBase } from '../../../../src/pageObjects/pageObjectBase';

class SelfHealingSatFixturePage extends PageObjectBase {
  constructor(page: Page) {
    super(page, 'SelfHealingSatFixturePage');
  }
}

const ARTIFACTS_DIR = path.join(process.cwd(), 'test-results', 'self-healing');
const ENV_KEYS = [
  'AURORAFLOW_RUN_ID',
  'AURORAFLOW_TEST_ID',
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

test('self-healing SAT enriches a deterministic failed page-object action', async ({ page }) => {
  const previousEnv = captureEnv();
  try {
    await rm(ARTIFACTS_DIR, { recursive: true, force: true });
    process.env.AURORAFLOW_RUN_ID = 'sat-e2e-run';
    process.env.AURORAFLOW_TEST_ID = 'sat-e2e-test';
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

    const artifacts = await readdir(ARTIFACTS_DIR);
    expect(artifacts).toHaveLength(1);
    const artifact = JSON.parse(await readFile(path.join(ARTIFACTS_DIR, artifacts[0]), 'utf8')) as {
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
    };

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
    await rm(ARTIFACTS_DIR, { recursive: true, force: true });
  }
});
