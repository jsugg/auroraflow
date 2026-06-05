import { expect, test } from '@playwright/test';
import { ExamplePage } from '../../../../examples/demo/pageObjects/ExamplePage';
import { PageFactory } from '../../../../src/helpers/pageFactory';

test('@smoke example page object uses the deterministic demo fixture', async ({ page }) => {
  const pageFactory = new PageFactory(page);
  const examplePage = pageFactory.getPage(ExamplePage);

  await examplePage.open();

  await expect(page.getByRole('heading', { name: 'Example Demo App' })).toBeVisible();
  await expect(await examplePage.getNavigationMenuLinksTexts()).toEqual([
    'Our Brands',
    'Featured in the News',
    'Careers',
  ]);
  await expect(await examplePage.isHeroVideoPresent()).toBe(true);
  await expect(await examplePage.isFeaturedNewsPresent()).toBe(true);

  await examplePage.clickOnJoinOurTeam();
  await expect(await examplePage.callToActionStatusText()).toBe('Team CTA selected.');
});
