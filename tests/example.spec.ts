import { PageFactory } from '../src/helpers/pageFactory';
import ExamplePage from '../src/pageObjects/examplePage';
import { test, expect } from '@playwright/test';

test('verify navigation menu links are correct', async ({ page }) => {
  const pageFactory: PageFactory = new PageFactory(page);
  const homePage: ExamplePage = pageFactory.getPage(ExamplePage);

  await homePage.open();

  const linksTexts: string[] = await homePage.getNavigationMenuLinksTexts();
  const trimmedArray: string[] = linksTexts.map((s: string) => s.trim());

  expect(trimmedArray).toContain('Our Brands');
});
