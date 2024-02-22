import { Page } from 'playwright';
import { PageObjectBase } from './pageObjectBase';

class ExamplePage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
    this.url = 'https://www.playonsports.com';
  }

  // Selectors
  private get navigationMenuLinks() {
    return this.page.locator('.hhs-nav-grid__menu >> a');
  }
  private get heroVideo() {
    return this.page.locator('.hhs-hero-mod video');
  }
  private get featuredNewsSection() {
    return this.page.locator('text=Featured in the News');
  }
  private get joinOurTeamButton() {
    return this.page.locator('text=Join Our Team');
  }

  public async navigateToSection(linkText: string) {
    await this.page.locator(`text=${linkText}`).first().click();
    await this.page.waitForLoadState('networkidle');
  }

  public async clickOnJoinOurTeam() {
    await this.joinOurTeamButton.click();
  }

  public async getNavigationMenuLinksTexts() {
    return await this.navigationMenuLinks.allTextContents();
  }

  public async isHeroVideoPresent() {
    return await this.heroVideo.isVisible();
  }

  public async isFeaturedNewsPresent() {
    return await this.featuredNewsSection.isVisible();
  }
}

export default ExamplePage;
