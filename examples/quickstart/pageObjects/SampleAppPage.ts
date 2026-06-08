import type { Page } from 'playwright';
import { PageObjectBase } from '../../../src/pageObjects/pageObjectBase';

export class SampleAppPage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
  }

  public override async open(url: string = this.url): Promise<void> {
    await this.navigateTo(url, { waitUntil: 'domcontentloaded' });
  }

  public async submitName(name: string): Promise<void> {
    await this.type('#name-input', name);
    await this.click('button[type="submit"]');
  }

  public async statusText(): Promise<string> {
    return ((await this.getText('#status')) ?? '').trim();
  }
}
