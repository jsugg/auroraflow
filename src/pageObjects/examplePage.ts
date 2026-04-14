import { Page } from 'playwright';
import { PageObjectBase } from './pageObjectBase';

class ExamplePage extends PageObjectBase {
  private readonly navigationMenuLinksSelector = '.hhs-nav-grid__menu >> a';
  private readonly heroVideoSelector = '.hhs-hero-mod video';
  private readonly featuredNewsSelector = 'text=Featured in the News';
  private readonly joinOurTeamSelector = 'text=Join Our Team';

  constructor(page: Page) {
    super(page);
    this.url = 'https://www.playonsports.com';
  }

  // Selectors
  private get navigationMenuLinks() {
    return this.page.locator(this.navigationMenuLinksSelector);
  }
  private get heroVideo() {
    return this.page.locator(this.heroVideoSelector);
  }
  private get featuredNewsSection() {
    return this.page.locator(this.featuredNewsSelector);
  }

  public async navigateToSection(linkText: string): Promise<void> {
    await this.click(`text=${linkText}`);
    await this.page.waitForLoadState('networkidle');
  }

  public async clickOnJoinOurTeam(): Promise<void> {
    await this.click(this.joinOurTeamSelector);
  }

  public async getNavigationMenuLinksTexts(): Promise<string[]> {
    return this.safeAction(
      () => this.navigationMenuLinks.allTextContents(),
      'Retrieved navigation menu link texts.',
      'Error retrieving navigation menu link texts',
      { type: 'read', target: this.navigationMenuLinksSelector },
    );
  }

  public async isHeroVideoPresent(): Promise<boolean> {
    return this.safeAction(
      () => this.heroVideo.isVisible(),
      'Verified hero video visibility.',
      'Error checking hero video visibility',
      { type: 'read', target: this.heroVideoSelector },
    );
  }

  public async isFeaturedNewsPresent(): Promise<boolean> {
    return this.safeAction(
      () => this.featuredNewsSection.isVisible(),
      'Verified featured news section visibility.',
      'Error checking featured news section visibility',
      { type: 'read', target: this.featuredNewsSelector },
    );
  }
}

export default ExamplePage;
