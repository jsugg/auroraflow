import { test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SampleAppPage } from '../../../../examples/quickstart/pageObjects/SampleAppPage';
import { ReliabilityAppPage } from '../../../../examples/reliability/pageObjects/ReliabilityAppPage';
import { expectNoAccessibilityViolations } from './accessibilityAssertions';

function fixtureUrl(relativePath: string): string {
  return pathToFileURL(path.join(process.cwd(), relativePath)).toString();
}

test('@smoke quickstart fixture has no detectable accessibility violations', async ({ page }) => {
  const samplePage = new SampleAppPage(page);

  await samplePage.open(fixtureUrl('examples/quickstart/fixtures/sample-app.html'));

  await expectNoAccessibilityViolations(page);
});

test('@smoke reliability fixture has no detectable accessibility violations', async ({ page }) => {
  const reliabilityPage = new ReliabilityAppPage(page);

  await reliabilityPage.open(fixtureUrl('examples/reliability/fixtures/reliability-app.html'));

  await expectNoAccessibilityViolations(page);
});
