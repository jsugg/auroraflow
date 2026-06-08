import { describe, expect, it } from 'vitest';
import {
  SelectorRegistryRepository,
  type SelectorStore,
} from '../../../../../src/data/selectors/selectorRegistry';
import {
  createStoreSelfHealingRegistryRuntime,
  resolveSelfHealingRegistryRuntime,
} from '../../../../../src/framework/selfHealing/registryRuntime';
import type { SelfHealingConfig } from '../../../../../src/framework/selfHealing/types';

class InMemorySelectorStore implements SelectorStore {
  private readonly records = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.records.get(key) ?? null;
  }

  public async getMany(keys: readonly string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.records.get(key) ?? null);
  }

  public async set(key: string, value: string): Promise<void> {
    this.records.set(key, value);
  }

  public async del(key: string): Promise<number> {
    return this.records.delete(key) ? 1 : 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    const matcher = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return [...this.records.keys()].filter((key) => matcher.test(key));
  }

  public rawSet(key: string, value: string): void {
    this.records.set(key, value);
  }
}

function selfHealingConfig(
  registryMode: SelfHealingConfig['sat']['registryMode'],
): SelfHealingConfig {
  return {
    mode: 'suggest',
    minConfidence: 0.92,
    safetyPolicy: {
      allowedActions: ['click'],
      allowedDomains: [],
    },
    sat: {
      enabled: true,
      captureDom: false,
      maxDomNodes: 500,
      maxCandidates: 10,
      maxTextLength: 120,
      allowedAttributes: ['data-testid'],
      registryMode,
      promotionMode: 'manual',
    },
  };
}

describe('self-healing registry runtime', () => {
  it('adapts selector registry and candidate history stores for SAT reads', async () => {
    const store = new InMemorySelectorStore();
    const activeRegistry = new SelectorRegistryRepository({
      store,
      namespace: 'selector-registry',
      now: () => new Date('2026-06-08T12:00:00.000Z'),
    });
    await activeRegistry.upsert({
      id: 'checkout.submit',
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      locator: "page.getByTestId('submit-order')",
      confidence: 0.94,
    });
    store.rawSet(
      'selector-history:v2::CheckoutPage::click::candidate',
      JSON.stringify({
        candidateId: 'v2::CheckoutPage::click::candidate',
        attempts: 3,
        validated: 2,
        guardedApplySucceeded: 1,
        guardedApplyFailed: 0,
        promoted: 0,
        rejected: 0,
      }),
    );

    const runtime = createStoreSelfHealingRegistryRuntime({ store, required: true });

    await expect(runtime.selectors.get('checkout.submit')).resolves.toMatchObject({
      id: 'checkout.submit',
      version: 1,
    });
    await expect(
      runtime.selectors.findCandidates?.({
        pageObjectName: 'CheckoutPage',
        actionType: 'click',
        limit: 5,
      }),
    ).resolves.toHaveLength(1);
    const histories = await runtime.histories.getMany(['v2::CheckoutPage::click::candidate']);
    expect(histories.get('v2::CheckoutPage::click::candidate')).toMatchObject({
      attempts: 3,
      validated: 2,
    });
    expect(runtime.required).toBe(true);
  });

  it('keeps default read mode opportunistic until Redis is configured or required', () => {
    expect(resolveSelfHealingRegistryRuntime({}, selfHealingConfig('read'))).toBeUndefined();
    expect(
      resolveSelfHealingRegistryRuntime(
        {
          SELF_HEAL_REGISTRY_REQUIRED: 'true',
        },
        selfHealingConfig('read'),
      ),
    ).toBeDefined();
    expect(
      resolveSelfHealingRegistryRuntime(
        {
          AURORAFLOW_REDIS_URL: 'redis://127.0.0.1:6379/0',
        },
        selfHealingConfig('read'),
      ),
    ).toBeDefined();
    expect(
      resolveSelfHealingRegistryRuntime(
        {
          SELF_HEAL_REGISTRY_REQUIRED: 'true',
        },
        selfHealingConfig('off'),
      ),
    ).toBeUndefined();
  });
});
