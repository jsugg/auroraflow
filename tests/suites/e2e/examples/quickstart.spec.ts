import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SampleAppPage } from '../../../../examples/quickstart/pageObjects/SampleAppPage';

function fixtureUrl(): string {
  const fixturePath = path.join(process.cwd(), 'examples/quickstart/fixtures/sample-app.html');
  return pathToFileURL(fixturePath).toString();
}

test('@smoke quickstart fixture form submits deterministic greeting', async ({ page }) => {
  const samplePage = new SampleAppPage(page);

  await samplePage.open(fixtureUrl());
  await samplePage.submitName('Aurora');

  await expect(page.getByRole('heading', { name: 'Quickstart App' })).toBeVisible();
  await expect(await samplePage.statusText()).toBe('Hello, Aurora!');
});
