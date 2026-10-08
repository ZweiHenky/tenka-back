import { describe, expect, it, vi } from 'vitest';
import { effectiveAccessMaterializerInternals } from './effectiveAccessMaterializer';

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-1',
    assignedAt: new Date('2026-09-01T12:00:00Z'),
    divisionId: 'division-1',
    divisionIdSnapshot: 'division-1',
    divisionNameSnapshot: 'Division 1',
    leagueIdSnapshot: 'league-1',
    leagueNameSnapshot: 'League 1',
    ownerUserIdSnapshot: 'user-1',
    slotNumber: 2,
    ...overrides,
  };
}

describe('effective access rollover planner', () => {
  it('preserves sparse slots when capacity is equal or higher', () => {
    expect(effectiveAccessMaterializerInternals.planRolloverAssignments([
      assignment({ id: 'a', slotNumber: 2 }),
      assignment({ id: 'b', slotNumber: 5, divisionId: 'division-2', divisionIdSnapshot: 'division-2' }),
    ], 5, 6)).toMatchObject([
      { id: 'a', slotNumber: 2, assignmentSource: 'PERIOD_ROLLOVER' },
      { id: 'b', slotNumber: 5, assignmentSource: 'PERIOD_ROLLOVER' },
    ]);
  });

  it('uses oldest assignment then stable id for downgrade fallback', () => {
    expect(effectiveAccessMaterializerInternals.planRolloverAssignments([
      assignment({ id: 'z', slotNumber: 1, assignedAt: new Date('2026-09-03T00:00:00Z') }),
      assignment({ id: 'b', slotNumber: 4, divisionId: 'division-2', divisionIdSnapshot: 'division-2' }),
      assignment({ id: 'a', slotNumber: 5, divisionId: 'division-3', divisionIdSnapshot: 'division-3' }),
    ], 5, 2)).toMatchObject([
      { id: 'a', slotNumber: 1, assignmentSource: 'RENEWAL_FALLBACK' },
      { id: 'b', slotNumber: 2, assignmentSource: 'RENEWAL_FALLBACK' },
    ]);
  });

  it('never rolls a deleted division into another period', () => {
    expect(effectiveAccessMaterializerInternals.planRolloverAssignments([
      assignment({ divisionId: null }),
    ], 2, 2)).toEqual([]);
  });
});

describe('effective access transition classification', () => {
  const providerPeriodStart = new Date('2026-10-01T12:00:00Z');

  it('treats first purchases and free-to-paid transitions as purchases', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: null,
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(true);
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: providerPeriodStart,
      providerPeriodStart,
      hasActiveFreeGrant: true,
    })).toBe(true);
  });

  it('keeps overlapping and adjacent paid periods continuous even when processed late', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: providerPeriodStart,
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(false);
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: new Date('2026-10-02T12:00:00Z'),
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(false);
  });

  it('treats a strict gap as a repurchase regardless of current provider chain', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: new Date(providerPeriodStart.getTime() - 1),
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(true);
  });

  it('does not reclassify an active paid period because of inconsistent free state', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: true,
      predecessorAccessEnd: new Date('2026-09-01T12:00:00Z'),
      providerPeriodStart,
      hasActiveFreeGrant: true,
    })).toBe(false);
  });
});

describe('Google two-step change reconciliation', () => {
  const intermediateVariant = {
    logicalProductId: 'tenka_capacity_6', storeProductId: 'tenka_capacity_6', basePlanId: 'monthly',
    capacity: 6, billingInterval: 'MONTHLY',
  };
  const targetVariant = {
    logicalProductId: 'tenka_capacity_6', storeProductId: 'tenka_capacity_6', basePlanId: 'annual',
    capacity: 6, billingInterval: 'ANNUAL',
  };

  function txFor(status: 'FIRST_PURCHASE_PENDING' | 'FIRST_VERIFICATION_PENDING' | 'SECOND_STEP_PENDING') {
    const purpose = status === 'FIRST_VERIFICATION_PENDING' || status === 'FIRST_PURCHASE_PENDING'
      ? 'PRODUCT_CHANGE_FIRST_STEP' : 'PRODUCT_CHANGE_FINAL_STEP';
    return {
      billingChangeOperation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'operation-1', status, version: 2, providerSubscriptionChainId: 'chain-1',
          intermediateVariant, targetVariant,
          providerSubscriptionChain: { providerChainReference: 'provider-chain-1' },
          checkoutAttempts: [{
            id: 'attempt-1', purpose, status: 'VERIFICATION_PENDING', version: 2,
            requestFingerprint: 'a'.repeat(64), verification: null,
          }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      billingVerification: {
        create: vi.fn().mockResolvedValue({ id: 'verification-1', status: 'PENDING', attemptCount: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      billingCheckoutAttempt: { update: vi.fn().mockResolvedValue({}) },
    };
  }

  function evidence(currentProduct: typeof intermediateVariant, pendingProduct: typeof targetVariant | null = null) {
    return {
      customerId: 'billing-1', observedAt: new Date('2026-10-08T00:00:00Z'), issues: [],
      subscriptions: [{
        providerSubscriptionKey: 'subscription-1', providerChainReference: 'provider-chain-1',
        storeEnvironment: 'SANDBOX', providerStatus: 'ACTIVE', providerStatusUpdatedAt: new Date(),
        entitlementActive: true, pendingPayment: false, eligibleForContinuedAccess: true,
        eligibleForNewAccess: true, eligibleForLocalGrace: false, providerEndReason: null,
        canonicalEvidenceReference: 'evidence-1', providerAccessEndsAt: new Date('2027-01-01T00:00:00Z'),
        willRenew: true, canceledAt: null, ownershipType: 'PURCHASED', currentProduct, pendingProduct,
        pendingEffectiveAt: pendingProduct ? new Date('2026-11-01T00:00:00Z') : null,
        transactions: [], periods: [],
      }],
    };
  }

  it('verifies the first step only from an exact canonical intermediate variant', async () => {
    const tx = txFor('FIRST_VERIFICATION_PENDING');
    await effectiveAccessMaterializerInternals.reconcileGoogleTwoStepChangeOperation(
      tx as never, 'billing-1', evidence(intermediateVariant) as never, new Date('2026-10-08T00:00:00Z'),
    );
    expect(tx.billingVerification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'VERIFIED', providerSubscriptionChainId: 'chain-1' }),
    }));
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ status: 'FIRST_VERIFIED', firstVerificationId: 'verification-1' }),
    }));
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'SECOND_STEP_PENDING' }),
    }));
  });

  it('completes safely when late evidence already exposes the final variant', async () => {
    const tx = txFor('SECOND_STEP_PENDING');
    await effectiveAccessMaterializerInternals.reconcileGoogleTwoStepChangeOperation(
      tx as never, 'billing-1', evidence(targetVariant as typeof intermediateVariant) as never,
      new Date('2026-10-08T00:00:00Z'),
    );
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ status: 'SCHEDULED', secondVerificationId: 'verification-1' }),
    }));
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
  });

  it('recovers a first step from canonical evidence even before the SDK outcome is reported', async () => {
    const tx = txFor('FIRST_PURCHASE_PENDING');
    await effectiveAccessMaterializerInternals.reconcileGoogleTwoStepChangeOperation(
      tx as never, 'billing-1', evidence(intermediateVariant) as never, new Date('2026-10-08T00:00:00Z'),
    );
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ status: 'FIRST_VERIFICATION_PENDING' }),
    }));
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'FIRST_VERIFIED' }),
    }));
    expect(tx.billingChangeOperation.update).toHaveBeenNthCalledWith(3, expect.objectContaining({
      data: expect.objectContaining({ status: 'SECOND_STEP_PENDING' }),
    }));
  });

  it('does not advance from blocking or ineligible evidence', async () => {
    const tx = txFor('FIRST_VERIFICATION_PENDING');
    const unsafe = evidence(intermediateVariant);
    unsafe.issues.push({ code: 'ENVIRONMENT_MISMATCH', severity: 'BLOCKING' } as never);
    await effectiveAccessMaterializerInternals.reconcileGoogleTwoStepChangeOperation(
      tx as never, 'billing-1', unsafe as never, new Date('2026-10-08T00:00:00Z'),
    );
    expect(tx.billingChangeOperation.update).not.toHaveBeenCalled();
    expect(tx.billingVerification.create).not.toHaveBeenCalled();
  });

  it.each(['BILLING_RETRY', 'STORE_GRACE', 'PAUSED'] as const)(
    'accepts exact %s evidence when the normalizer marks it eligible for new access',
    async (providerStatus) => {
      const tx = txFor('FIRST_VERIFICATION_PENDING');
      const safe = evidence(intermediateVariant);
      safe.subscriptions[0].providerStatus = providerStatus;
      await effectiveAccessMaterializerInternals.reconcileGoogleTwoStepChangeOperation(
        tx as never, 'billing-1', safe as never, new Date('2026-10-08T00:00:00Z'),
      );
      expect(tx.billingChangeOperation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'FIRST_VERIFIED' }),
      }));
    },
  );
});
