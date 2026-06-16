import type { Page } from '@playwright/test';
import type { SelfHealingRegistryRuntime } from '../../../../src/framework/selfHealing/registryContracts';
import { PageObjectBase } from '../../../../src/pageObjects/pageObjectBase';

export const FIXTURE_APP_PATH = '/index.html';

export class FixtureSelfHealingPage extends PageObjectBase {
  public constructor(
    page: Page,
    private readonly registryRuntime?: SelfHealingRegistryRuntime,
  ) {
    super(page, 'FixtureSelfHealingPage');
  }

  protected override resolveRegistryRuntime(): SelfHealingRegistryRuntime | undefined {
    return this.registryRuntime;
  }

  public async openFixture(): Promise<void> {
    await this.navigateTo(FIXTURE_APP_PATH);
  }
}
