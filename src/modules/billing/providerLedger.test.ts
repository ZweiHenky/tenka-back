import { describe, expect, it } from 'vitest';
import { providerLedgerInternals } from './providerLedger';

describe('provider ledger mapping', () => {
  it('writes complete or empty commercial snapshots', () => {
    expect(providerLedgerInternals.commercialSnapshot(null, 'current')).toEqual({
      currentLogicalProductId: null,
      currentStoreProductId: null,
      currentBasePlanId: null,
      currentCapacity: null,
      currentBillingInterval: null,
    });
    expect(providerLedgerInternals.commercialSnapshot({
      logicalProductId: 'tenka_capacity_2', store: 'GOOGLE', storeProductId: 'tenka_capacity_2',
      basePlanId: 'monthly', revenueCatOfferingId: 'capacity_2', revenueCatPackageId: '$rc_monthly',
      revenueCatProductIdentifier: 'tenka_capacity_2:monthly', capacity: 2,
      billingInterval: 'MONTHLY', intervalMonths: 1, active: true,
    }, 'pending')).toMatchObject({
      pendingLogicalProductId: 'tenka_capacity_2', pendingBasePlanId: 'monthly', pendingCapacity: 2,
    });
  });

  it('compares immutable transaction evidence exactly', () => {
    const transaction = {
      providerTransactionId: 'GPA.1', eventType: 'UNKNOWN' as const,
      logicalProductId: 'tenka_capacity_2', storeProductId: 'tenka_capacity_2', basePlanId: 'monthly',
      capacity: 2, billingInterval: 'MONTHLY' as const, purchasedAt: new Date('2026-09-01T00:00:00Z'),
    };
    const existing = {
      providerSubscriptionId: 'sub-row', storeEnvironment: 'SANDBOX',
      logicalProductId: transaction.logicalProductId, storeProductId: transaction.storeProductId,
      basePlanId: transaction.basePlanId, capacity: transaction.capacity,
      billingInterval: transaction.billingInterval, purchasedAt: new Date(transaction.purchasedAt),
    };
    expect(providerLedgerInternals.sameTransaction(existing, 'sub-row', 'SANDBOX', transaction)).toBe(true);
    expect(providerLedgerInternals.sameTransaction({ ...existing, capacity: 3 }, 'sub-row', 'SANDBOX', transaction)).toBe(false);
  });
});
