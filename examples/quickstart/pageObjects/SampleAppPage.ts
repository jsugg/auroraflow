import { Page } from '@playwright/test';

export class SampleAppPage {
  constructor(private readonly page: Page) {}

  public async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  public async submitName(name: string): Promise<void> {
    await this.page.getByLabel('Name').fill(name);
    await this.page.getByRole('button', { name: 'Submit' }).click();
  }

  public async statusText(): Promise<string> {
    return (await this.page.locator('#status').innerText()).trim();
  }
}
