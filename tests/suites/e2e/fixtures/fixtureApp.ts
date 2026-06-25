import type { Page } from '@playwright/test';
import {
  createAuroraFlowContext,
  type AuroraFlowContextOptions,
} from '../../../../src/framework/runtime/auroraFlowContext';
import type { SelfHealingRegistryRuntime } from '../../../../src/framework/selfHealing/registryContracts';
import type { SelfHealingConfig } from '../../../../src/framework/selfHealing/types';
import { PageObjectBase } from '../../../../src/pageObjects/pageObjectBase';

export const FIXTURE_APP_PATH = '/index.html';

export class FixtureSelfHealingPage extends PageObjectBase {
  public constructor(
    page: Page,
    private readonly registryRuntime?: SelfHealingRegistryRuntime,
    contextOptions: AuroraFlowContextOptions = {},
  ) {
    super(page, 'FixtureSelfHealingPage', createAuroraFlowContext(contextOptions));
  }

  protected override resolveRegistryRuntime(
    config: SelfHealingConfig,
  ): SelfHealingRegistryRuntime | undefined {
    return this.registryRuntime ?? super.resolveRegistryRuntime(config);
  }

  public async openFixture(): Promise<void> {
    await this.navigateTo(FIXTURE_APP_PATH);
  }
}
