import { expect, test, type Page } from '@playwright/test';
import { createAuroraFlowContext } from '../../../../src/framework/runtime/auroraFlowContext';
import { PageObjectBase } from '../../../../src/pageObjects/pageObjectBase';
import {
  createPlaywrightSelfHealingArtifactScope,
  readSelfHealingArtifactFor,
  type SelfHealingArtifactScope,
} from '../../../helpers/selfHealingArtifacts';

class SelfHealingSatFixturePage extends PageObjectBase {
  constructor(page: Page, scope: SelfHealingArtifactScope) {
    super(
      page,
      'SelfHealingSatFixturePage',
      createAuroraFlowContext({
        env: {
          ...scope.env,
          SELF_HEAL_MODE: 'suggest',
          SELF_HEAL_MIN_CONFIDENCE: '0.9',
          SELF_HEAL_SAT_ENABLED: 'true',
          SELF_HEAL_SAT_CAPTURE_DOM: 'true',
          SELF_HEAL_MAX_DOM_NODES: '50',
          SELF_HEAL_MAX_CANDIDATES: '10',
        },
      }),
    );
  }
}

test('@smoke self-healing SAT enriches a deterministic failed page-object action', async ({
  page,
}, testInfo) => {
  const artifactScope = await createPlaywrightSelfHealingArtifactScope(testInfo, {
    prefix: 'self-healing-sat',
  });

  await page.setContent(`
      <main>
        <form aria-label="Checkout">
          <button id="submit-order" data-testid="submit-order" type="button">
            Submit order
          </button>
        </form>
      </main>
    `);

  const fixturePage = new SelfHealingSatFixturePage(page, artifactScope);
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
});
