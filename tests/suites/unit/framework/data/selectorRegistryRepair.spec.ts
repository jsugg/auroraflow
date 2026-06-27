import { describe, expect, it } from 'vitest';
import { repairSelfHealingRegistry } from '../../../../../scripts/self-healing-registry-repair';
import { createMemorySelectorStore } from '../../../../../src/data/selectors/memorySelectorStore';
import { readArtifactFixture } from '../../../../helpers/artifactFixtures';

describe('selector registry repair', () => {
  it('reports schema/index drift in dry-run and repairs it only when applied', async () => {
    const store = createMemorySelectorStore();
    const legacyKey = 'selectors:checkout.legacy-submit';
    const currentKey = 'selectors:checkout.submit';
    const legacyPayload = JSON.stringify(
      await readArtifactFixture('legacy/selector-registry-record.json'),
    );
    const currentPayload = JSON.stringify(
      await readArtifactFixture('v1/selector-registry-record.json'),
    );
    await store.set(legacyKey, legacyPayload);
    await store.set(currentKey, currentPayload);
    await store.set('selectors-index:LegacyPage:click:checkout.legacy-submit', legacyKey);
    await store.set('selectors-index:CheckoutPage:click:checkout.submit', 'selectors:missing');
    await store.set('selectors-index:MissingPage:click:missing', 'selectors:missing');

    const dryRun = await repairSelfHealingRegistry({ store, activeNamespace: 'selectors' });

    expect(dryRun).toMatchObject({
      dryRun: true,
      recordsScanned: 2,
      legacyRecords: 1,
      recordsUpgraded: 0,
      missingIndexes: 1,
      mismatchedIndexes: 1,
      staleIndexes: 2,
      indexesCreated: 0,
      indexesUpdated: 0,
      indexesDeleted: 0,
    });
    expect(await store.get(legacyKey)).toBe(legacyPayload);

    const applied = await repairSelfHealingRegistry({
      store,
      activeNamespace: 'selectors',
      dryRun: false,
    });

    expect(applied).toMatchObject({
      dryRun: false,
      legacyRecords: 1,
      recordsUpgraded: 1,
      upgradeConflicts: 0,
      indexesCreated: 1,
      indexesUpdated: 1,
      indexesDeleted: 2,
    });
    expect(JSON.parse((await store.get(legacyKey)) ?? '{}')).toMatchObject({
      schemaVersion: '1.0.0',
      version: 3,
    });

    await expect(
      repairSelfHealingRegistry({ store, activeNamespace: 'selectors' }),
    ).resolves.toMatchObject({
      legacyRecords: 0,
      missingIndexes: 0,
      mismatchedIndexes: 0,
      staleIndexes: 0,
      unverifiableIndexes: 0,
    });
    await store.close();
  });

  it('does not delete unverifiable indexes for malformed active records', async () => {
    const store = createMemorySelectorStore();
    await store.set('selectors:broken', '{"id":"broken"}');
    await store.set('selectors-index:Page:click:broken', 'selectors:broken');

    const summary = await repairSelfHealingRegistry({
      store,
      activeNamespace: 'selectors',
      dryRun: false,
    });

    expect(summary).toMatchObject({
      malformedRecords: 1,
      staleIndexes: 0,
      unverifiableIndexes: 1,
      indexesDeleted: 0,
      diagnostics: [{ key: 'selectors:broken' }, { key: 'selectors-index:Page:click:broken' }],
    });
    await expect(store.get('selectors-index:Page:click:broken')).resolves.toBe('selectors:broken');
    await store.close();
  });
});
