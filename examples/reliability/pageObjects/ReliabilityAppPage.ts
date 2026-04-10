import { Page } from '@playwright/test';

export class ReliabilityAppPage {
  constructor(private readonly page: Page) {}

  public async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  public async clickFetchMessage(): Promise<void> {
    await this.page.getByRole('button', { name: 'Fetch Message' }).click();
  }

  public async clickRenderDelayedStatus(): Promise<void> {
    await this.page.getByRole('button', { name: 'Render Delayed Status' }).click();
  }

  public async statusText(): Promise<string> {
    return (await this.page.locator('#status').innerText()).trim();
  }
}
