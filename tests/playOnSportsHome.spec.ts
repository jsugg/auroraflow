import { PageFactory } from '../src/helpers/pageFactory';
import PlayOnSportsHomePage from '../pageObjects/playOnSportsHome';
import { test, expect } from '@playwright/test';

test('verify navigation menu links are correct', async ({ page }) => {
  const pageFactory: PageFactory = new PageFactory(page);
  const homePage: PlayOnSportsHomePage =
    pageFactory.getPage(PlayOnSportsHomePage);

  await homePage.navigateTo('https://www.playonsports.com');

  const linksTexts: string[] = await homePage.getNavigationMenuLinksTexts();
  const trimmedArray: string[] = linksTexts.map((s: string) => s.trim());

  expect(trimmedArray).toContain('Our Brands');
});
