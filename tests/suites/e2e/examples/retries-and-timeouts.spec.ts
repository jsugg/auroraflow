import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { retry } from '../../../../src/helpers/helpers';
import { ReliabilityAppPage } from '../../../../examples/reliability/pageObjects/ReliabilityAppPage';

const MESSAGE_ENDPOINT = 'https://auroraflow.local/api/message';

function fixtureUrl(): string {
  const fixturePath = path.join(
    process.cwd(),
    'examples/reliability/fixtures/reliability-app.html',
  );
  return pathToFileURL(fixturePath).toString();
}

test('@smoke targeted retry recovers from transient API failures', async ({ page }) => {
  let attempts = 0;
  const reliabilityPage = new ReliabilityAppPage(page);

  await page.route(MESSAGE_ENDPOINT, async (route) => {
    attempts += 1;
    if (attempts < 3) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Transient error ${attempts}` }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Recovered on attempt 3' }),
    });
  });

  await reliabilityPage.open(fixtureUrl());

  await retry({
    fn: async () => {
      await Promise.all([
        page.waitForResponse((response) => response.url() === MESSAGE_ENDPOINT, {
          timeout: 1_000,
        }),
        reliabilityPage.clickFetchMessage(),
      ]);

      const status = await reliabilityPage.statusText();
      if (status !== 'Recovered on attempt 3') {
        throw new Error(`Unexpected status during retry loop: ${status}`);
      }
    },
    retries: 3,
    initialDelay: 20,
    backoffFactor: 2,
    logger: null,
  });

  expect(attempts).toBe(3);
  await expect(await reliabilityPage.statusText()).toBe('Recovered on attempt 3');
});

test('@smoke explicit timeout assertion handles delayed UI updates deterministically', async ({
  page,
}) => {
  const reliabilityPage = new ReliabilityAppPage(page);

  await reliabilityPage.open(fixtureUrl());
  await reliabilityPage.clickRenderDelayedStatus();

  await expect
    .poll(() => reliabilityPage.statusText(), {
      timeout: 1_500,
      intervals: [100, 200, 300],
    })
    .toBe('Rendered after delay');
});
