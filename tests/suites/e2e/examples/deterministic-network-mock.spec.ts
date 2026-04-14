import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReliabilityAppPage } from '../../../../examples/reliability/pageObjects/ReliabilityAppPage';

const MESSAGE_ENDPOINT = 'https://auroraflow.local/api/message';

function fixtureUrl(): string {
  const fixturePath = path.join(
    process.cwd(),
    'examples/reliability/fixtures/reliability-app.html',
  );
  return pathToFileURL(fixturePath).toString();
}

test('@smoke deterministic network mock returns stable API response', async ({ page }) => {
  const reliabilityPage = new ReliabilityAppPage(page);

  await page.route(MESSAGE_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Hello from deterministic mock' }),
    });
  });

  await reliabilityPage.open(fixtureUrl());
  await reliabilityPage.clickFetchMessage();

  await expect
    .poll(() => reliabilityPage.statusText(), {
      timeout: 1_000,
      intervals: [50, 100, 200],
    })
    .toBe('Hello from deterministic mock');
});
