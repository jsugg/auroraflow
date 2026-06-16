import { expect, test } from '@playwright/test';
import { FIXTURE_APP_PATH } from './fixtureApp';

test('@smoke fixture app serves stable, dynamic, shadow, and iframe controls', async ({ page }) => {
  await page.goto(FIXTURE_APP_PATH);

  await expect(page.getByTestId('guarded-submit')).toBeVisible();
  await expect(page.getByTestId('dynamic-submit')).toBeVisible();
  await expect(
    page.locator('shadow-checkout').locator('[data-testid="shadow-submit"]'),
  ).toBeVisible();
  await expect(
    page.frameLocator('iframe[title="Checkout iframe"]').getByTestId('iframe-submit'),
  ).toBeVisible();
});
