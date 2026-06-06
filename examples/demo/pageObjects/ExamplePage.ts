import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Page } from 'playwright';
import { PageObjectBase } from '../../../src/pageObjects/pageObjectBase';

function defaultFixtureUrl(): string {
  const fixturePath = path.join(process.cwd(), 'examples/demo/fixtures/example-app.html');
  return pathToFileURL(fixturePath).toString();
}

export class ExamplePage extends PageObjectBase {
  private readonly navigationMenuLinksSelector = 'nav[aria-label="Primary"] a';
  private readonly heroVideoSelector = '[data-testid="hero-video"]';
  private readonly featuredNewsSelector = '#news-heading';
  private readonly joinOurTeamSelector = '#join-team';
  private readonly callToActionStatusSelector = '#cta-status';

  constructor(page: Page, url: string = defaultFixtureUrl()) {
    super(page);
    this.url = url;
  }

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
  }

  public async clickOnJoinOurTeam(): Promise<void | null> {
    return this.click(this.joinOurTeamSelector);
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

  public async callToActionStatusText(): Promise<string> {
    return (
      (await this.getText(this.callToActionStatusSelector)) ?? 'Call to action status unavailable.'
    ).trim();
  }
}
