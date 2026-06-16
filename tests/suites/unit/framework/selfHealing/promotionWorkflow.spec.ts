import { describe, expect, it } from 'vitest';
import {
  MemorySelectorStore,
  createMemorySelectorStore,
} from '../../../../../src/data/selectors/memorySelectorStore';
import { SelfHealingPromotionWorkflow } from '../../../../../src/framework/selfHealing/promotionWorkflow';
import { parsePendingSelectorPromotion } from '../../../../../src/framework/selfHealing/artifactSchema';
import { parseArgs } from '../../../../../scripts/self-healing-promotions';

function workflowFixture() {
  const store = createMemorySelectorStore();
  const workflow = new SelfHealingPromotionWorkflow({
    store,
    activeNamespace: 'selector-registry-promotions-unit',
    now: () => new Date('2026-06-08T14:00:00.000Z'),
  });
  return { store, workflow };
}

async function seedActiveSelector(store: MemorySelectorStore): Promise<void> {
  await store.set(
    'selector-registry-promotions-unit:checkout.submit',
    JSON.stringify({
      id: 'checkout.submit',
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      locator: '#legacy-submit',
      strategy: 'registry',
      confidence: 0.42,
      notes: 'legacy note',
      updatedAt: '2026-06-08T13:00:00.000Z',
      version: 3,
    }),
  );
}

async function seedPromotion(store: MemorySelectorStore): Promise<void> {
  await store.set(
    'selector-registry-promotions-unit-promotions:evt-1',
    JSON.stringify({
      promotionId: 'promotion:evt-1:candidate-new',
      eventId: 'evt-1',
      candidateId: 'candidate-new',
      selectorId: 'checkout.submit',
      proposedLocator: '#submit-primary',
      locator: '#submit-primary',
      baseSelectorVersion: 3,
      confidence: 0.91,
      status: 'pending',
      requestedAt: '2026-06-08T13:30:00.000Z',
      acknowledged: false,
    }),
  );
}

describe('SelfHealingPromotionWorkflow', () => {
  it('approves promotions with CAS, audit, and promotion accounting', async () => {
    const { store, workflow } = workflowFixture();
    await seedActiveSelector(store);
    await seedPromotion(store);

    const result = await workflow.approve({
      eventId: 'evt-1',
      reviewer: 'reviewer-1',
    });

    expect(result.status).toBe('applied');
    expect(result.promotion).toMatchObject({
      status: 'applied',
      acknowledged: true,
      reviewedBy: 'reviewer-1',
      appliedSelectorVersion: 4,
      previousLocator: '#legacy-submit',
    });
    const appliedSelectorPayload = await store.get(
      'selector-registry-promotions-unit:checkout.submit',
    );
    expect(appliedSelectorPayload ? JSON.parse(appliedSelectorPayload) : null).toMatchObject({
      id: 'checkout.submit',
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      locator: '#submit-primary',
      strategy: 'registry',
      confidence: 0.91,
      notes: 'legacy note',
      updatedAt: '2026-06-08T14:00:00.000Z',
      version: 4,
    });
    const historyPayload = await store.get(
      'selector-registry-promotions-unit-history:candidate-new',
    );
    expect(historyPayload).not.toBeNull();
    expect(historyPayload ? JSON.parse(historyPayload) : null).toMatchObject({
      candidateId: 'candidate-new',
      promoted: 1,
      rejected: 0,
      rolledBack: 0,
    });
    const auditKeys = await store.keys('selector-registry-promotions-unit-audit:*');
    expect(auditKeys).toHaveLength(1);
  });

  it('marks stale approvals as explicit conflicts', async () => {
    const { store, workflow } = workflowFixture();
    await seedActiveSelector(store);
    await seedPromotion(store);
    await store.set(
      'selector-registry-promotions-unit:checkout.submit',
      JSON.stringify({
        id: 'checkout.submit',
        pageObjectName: 'CheckoutPage',
        actionType: 'click',
        locator: '#changed-elsewhere',
        strategy: 'registry',
        confidence: 0.42,
        updatedAt: '2026-06-08T13:59:59.000Z',
        version: 4,
      }),
    );

    const result = await workflow.approve({
      promotionId: 'promotion:evt-1:candidate-new',
      reviewer: 'reviewer-2',
    });

    expect(result.status).toBe('conflict');
    expect(result.promotion.status).toBe('conflict');
    expect(result.promotion.conflictReason).toContain('expected version 3');
  });

  it('rejects promotions with required reason and rejection accounting', async () => {
    const { store, workflow } = workflowFixture();
    await seedActiveSelector(store);
    await seedPromotion(store);

    const result = await workflow.reject({
      eventId: 'evt-1',
      reviewer: 'reviewer-3',
      reason: 'Candidate matched hidden duplicate.',
    });

    expect(result.status).toBe('rejected');
    expect(result.promotion).toMatchObject({
      status: 'rejected',
      reviewReason: 'Candidate matched hidden duplicate.',
    });
    const historyPayload = await store.get(
      'selector-registry-promotions-unit-history:candidate-new',
    );
    expect(historyPayload ? JSON.parse(historyPayload) : null).toMatchObject({
      rejected: 1,
      rolledBack: 0,
    });
  });

  it('rolls back applied promotions and restores previous selector snapshot', async () => {
    const { store, workflow } = workflowFixture();
    await seedActiveSelector(store);
    await store.set(
      'selector-registry-promotions-unit-promotions:evt-1',
      JSON.stringify({
        promotionId: 'promotion:evt-1:candidate-new',
        eventId: 'evt-1',
        candidateId: 'candidate-new',
        selectorId: 'checkout.submit',
        proposedLocator: '#submit-primary',
        locator: '#submit-primary',
        baseSelectorVersion: 3,
        confidence: 0.91,
        status: 'applied',
        requestedAt: '2026-06-08T13:30:00.000Z',
        acknowledged: true,
        reviewedBy: 'reviewer-1',
        reviewedAt: '2026-06-08T14:00:00.000Z',
        appliedAt: '2026-06-08T14:00:00.000Z',
        appliedSelectorVersion: 4,
        previousLocator: '#legacy-submit',
        previousConfidence: 0.42,
        previousStrategy: 'registry',
        previousNotes: 'legacy note',
      }),
    );
    await store.set(
      'selector-registry-promotions-unit:checkout.submit',
      JSON.stringify({
        id: 'checkout.submit',
        pageObjectName: 'CheckoutPage',
        actionType: 'click',
        locator: '#submit-primary',
        strategy: 'registry',
        confidence: 0.91,
        notes: 'legacy note',
        updatedAt: '2026-06-08T14:00:00.000Z',
        version: 4,
      }),
    );

    const result = await workflow.rollback({
      eventId: 'evt-1',
      reviewer: 'reviewer-4',
      reason: 'Promotion regressed checkout flow.',
    });

    expect(result.status).toBe('rolled_back');
    expect(result.promotion).toMatchObject({
      status: 'rolled_back',
      rolledBackAt: '2026-06-08T14:00:00.000Z',
    });
    const rolledBackSelectorPayload = await store.get(
      'selector-registry-promotions-unit:checkout.submit',
    );
    expect(rolledBackSelectorPayload ? JSON.parse(rolledBackSelectorPayload) : null).toMatchObject({
      id: 'checkout.submit',
      pageObjectName: 'CheckoutPage',
      actionType: 'click',
      locator: '#legacy-submit',
      strategy: 'registry',
      confidence: 0.42,
      notes: 'legacy note',
      updatedAt: '2026-06-08T14:00:00.000Z',
      version: 5,
    });
    const historyPayload = await store.get(
      'selector-registry-promotions-unit-history:candidate-new',
    );
    expect(historyPayload ? JSON.parse(historyPayload) : null).toMatchObject({
      rolledBack: 1,
    });
  });
});

describe('self-healing promotions script args', () => {
  it('parses command flags for reviewed promotion CLI', () => {
    const parsed = parseArgs([
      'approve',
      '--promotion-id',
      'promotion:evt-1:candidate-new',
      '--reviewer',
      'ci-bot',
    ]);

    expect(parsed).toEqual({
      command: 'approve',
      flags: {
        'promotion-id': 'promotion:evt-1:candidate-new',
        reviewer: 'ci-bot',
      },
    });
  });

  it('keeps extended promotion schema round-trippable', () => {
    const parsed = parsePendingSelectorPromotion({
      promotionId: 'promotion:evt-1:candidate-new',
      eventId: 'evt-1',
      candidateId: 'candidate-new',
      selectorId: 'checkout.submit',
      proposedLocator: '#submit-primary',
      locator: '#submit-primary',
      baseSelectorVersion: 3,
      confidence: 0.91,
      status: 'applied',
      requestedAt: '2026-06-08T13:30:00.000Z',
      acknowledged: true,
      reviewedBy: 'reviewer-1',
      reviewedAt: '2026-06-08T14:00:00.000Z',
      appliedAt: '2026-06-08T14:00:00.000Z',
      appliedSelectorVersion: 4,
      previousLocator: '#legacy-submit',
      previousConfidence: 0.42,
      previousStrategy: 'registry',
      previousNotes: 'legacy note',
    });

    expect(parsed.status).toBe('applied');
    expect(parsed.previousLocator).toBe('#legacy-submit');
  });
});
