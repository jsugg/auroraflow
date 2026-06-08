import type { Page } from 'playwright';
import { PageObjectBase } from '../../../src/pageObjects/pageObjectBase';

export class ReliabilityAppPage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
  }

  public override async open(url: string = this.url): Promise<void> {
    await this.navigateTo(url, { waitUntil: 'domcontentloaded' });
  }

  public async clickFetchMessage(): Promise<void> {
    await this.click('#fetch-message');
  }

  public async clickRenderDelayedStatus(): Promise<void> {
    await this.click('#render-delayed');
  }

  public async statusText(): Promise<string> {
    return ((await this.getText('#status')) ?? '').trim();
  }
}
