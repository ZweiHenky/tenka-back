import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBillingAccount: vi.fn(),
  getActiveBillingCatalog: vi.fn(),
  configureRawQuerySchema: vi.fn(),
  assertCanonicalBillingIdentity: vi.fn(),
  reconcilePeriodicCandidateNow: vi.fn(),
}));

vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../config/env', () => ({ env: { BILLING_REVENUECAT_ENABLED: true } }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: mocks.configureRawQuerySchema }));
vi.mock('./service', () => ({ ensureBillingAccount: mocks.ensureBillingAccount }));
vi.mock('./canonicalIdentity', () => ({ assertCanonicalBillingIdentity: mocks.assertCanonicalBillingIdentity }));
vi.mock('./catalog', () => ({
  billingEnvironmentForApp: vi.fn(() => 'PREVIEW'),
  getActiveBillingCatalog: mocks.getActiveBillingCatalog,
}));
vi.mock('./periodicReconciliationWorker', () => ({ reconcilePeriodicCandidateNow: mocks.reconcilePeriodicCandidateNow }));
vi.mock('../../workers/jobSignals', () => ({ signalBackgroundJob: vi.fn() }));

import { reportBillingCheckoutOutcome, startBillingCheckout, syncBillingCheckout } from './checkoutService';

const now = new Date('2026-09-26T10:00:00Z');

function catalog(purchasesEnabled = true) {
  return {
    available: true,
    environment: 'PREVIEW',
    purchasesEnabled,
    release: {
      id: 'release-1', version: 'v1',
      products: [{
        logicalProductId: 'tenka_capacity_2', billingInterval: 'MONTHLY', capacity: 2,
        store: 'GOOGLE', revenueCatOfferingId: 'capacity_2', revenueCatPackageId: '$rc_monthly',
        storeProductId: 'tenka_capacity_2', basePlanId: 'monthly',
      }],
    },
  };
}

function transaction() {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    billingCheckoutAttempt: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'attempt-1', purchaseSelectionId: 'selection-1', store: 'GOOGLE',
        logicalProductIdSnapshot: 'tenka_capacity_2', billingIntervalSnapshot: 'MONTHLY',
        targetCapacitySnapshot: 2, offeringIdSnapshot: 'capacity_2', packageIdSnapshot: '$rc_monthly',
        storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
        status: 'PREPARED', version: 1, startedAt: now, nextVerificationAt: null,
        terminalAt: null, lastErrorCode: null,
      }),
    },
    billingPurchaseSelection: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'selection-1', status: 'DRAFT', version: 3,
        logicalProductId: 'tenka_capacity_2', billingInterval: 'MONTHLY', targetCapacity: 2,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    billingAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ now, verificationAt: new Date('2026-09-26T10:05:00Z') }]),
  };
}

function checkoutAttempt(status: 'VERIFICATION_PENDING' | 'VERIFIED') {
  return {
    id: 'attempt-1', purchaseSelectionId: 'selection-1', store: 'GOOGLE' as const,
    logicalProductIdSnapshot: 'tenka_capacity_2', billingIntervalSnapshot: 'MONTHLY' as const,
    targetCapacitySnapshot: 2, offeringIdSnapshot: 'capacity_2', packageIdSnapshot: '$rc_monthly',
    storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
    status, version: 2, startedAt: now, nextVerificationAt: status === 'VERIFIED' ? null : now,
    terminalAt: status === 'VERIFIED' ? now : null, lastErrorCode: null,
  };
}

function syncClient(attempt: ReturnType<typeof checkoutAttempt> | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
    billingCheckoutAttempt: {
      findFirst: vi.fn().mockResolvedValue(attempt),
      findUnique: vi.fn().mockResolvedValue(attempt),
    },
  } as never;
}

describe('billing checkout service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureBillingAccount.mockResolvedValue({ id: 'billing-1' });
    mocks.getActiveBillingCatalog.mockResolvedValue(catalog());
    mocks.assertCanonicalBillingIdentity.mockResolvedValue(undefined);
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({ kind: 'SUCCESS' });
  });

  it('creates the durable attempt and locks the exact selection atomically', async () => {
    const tx = transaction();
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    const result = await startBillingCheckout({
      checkout: { purchaseSelectionId: 'selection-1', expectedVersion: 3, store: 'GOOGLE' },
      idempotencyKey: 'checkout-start-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client);

    expect(result).toMatchObject({
      id: 'attempt-1', status: 'PREPARED', offeringId: 'capacity_2',
      packageId: '$rc_monthly', productIdentifier: 'tenka_capacity_2:monthly',
    });
    expect(tx.billingPurchaseSelection.updateMany).toHaveBeenCalledWith({
      where: { id: 'selection-1', status: 'DRAFT', version: 3 },
      data: {
        status: 'LOCKED', lockedAt: now, checkoutAttemptId: 'attempt-1', version: { increment: 1 },
      },
    });
    expect(tx.billingCheckoutAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nextVerificationAt: new Date('2026-09-26T10:05:00Z') }),
    }));
    expect(tx.billingAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'BILLING_CHECKOUT_ATTEMPT_STARTED', idempotencyKey: 'checkout-start-1',
    }) });
  });

  it('fails before creating or locking when purchases are paused', async () => {
    mocks.getActiveBillingCatalog.mockResolvedValue(catalog(false));
    const tx = transaction();
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    await expect(startBillingCheckout({
      checkout: { purchaseSelectionId: 'selection-1', expectedVersion: 3, store: 'GOOGLE' },
      idempotencyKey: 'checkout-start-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).rejects.toMatchObject({ code: 'BILLING_PURCHASES_PAUSED', statusCode: 409 });
    expect(tx.billingCheckoutAttempt.create).not.toHaveBeenCalled();
    expect(tx.billingPurchaseSelection.updateMany).not.toHaveBeenCalled();
  });

  it('creates durable verification work for a pending store payment', async () => {
    const attempt = {
      id: 'attempt-1', purchaseSelectionId: 'selection-1', store: 'GOOGLE',
      logicalProductIdSnapshot: 'tenka_capacity_2', billingIntervalSnapshot: 'MONTHLY',
      targetCapacitySnapshot: 2, offeringIdSnapshot: 'capacity_2', packageIdSnapshot: '$rc_monthly',
      storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
      status: 'PREPARED', version: 1, startedAt: now, nextVerificationAt: null,
      terminalAt: null, lastErrorCode: null, requestFingerprint: 'start-fingerprint',
    };
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
      billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
      billingCheckoutAttempt: {
        findFirst: vi.fn().mockResolvedValue(attempt),
        update: vi.fn().mockResolvedValue({
          ...attempt, status: 'STORE_PENDING', version: 2, nextVerificationAt: now,
        }),
      },
      billingVerification: { upsert: vi.fn() },
      billingAuditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ now }]),
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(reportBillingCheckoutOutcome({
      attemptId: 'attempt-1', outcome: { outcome: 'PENDING' },
      idempotencyKey: 'pending-1', actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).resolves.toMatchObject({ status: 'STORE_PENDING', nextVerificationAt: now });
    expect(tx.billingVerification.upsert).toHaveBeenCalledWith({
      where: { checkoutAttemptId: 'attempt-1' },
      create: expect.objectContaining({
        billingAccountId: 'billing-1', checkoutAttemptId: 'attempt-1',
        store: 'GOOGLE', idempotencyKey: 'pending-1', requestedAt: now,
      }),
      update: {},
    });
  });

  it('keeps sync pending when reconciliation succeeds but checkout is nonterminal', async () => {
    await expect(syncBillingCheckout({
      userId: 'user-1', requestId: 'request-1', checkoutAttemptId: 'attempt-1',
    }, syncClient(checkoutAttempt('VERIFICATION_PENDING')))).resolves.toMatchObject({
      status: 'PENDING', reason: 'checkout_pending',
      attempt: { id: 'attempt-1', status: 'VERIFICATION_PENDING' },
    });
  });

  it('reports synchronized from the authoritative terminal attempt', async () => {
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({ kind: 'BUSY' });
    await expect(syncBillingCheckout({
      userId: 'user-1', requestId: 'request-1', checkoutAttemptId: 'attempt-1',
    }, syncClient(checkoutAttempt('VERIFIED')))).resolves.toMatchObject({
      status: 'SYNCHRONIZED', attempt: { id: 'attempt-1', status: 'VERIFIED' },
    });
  });

  it('reports synchronized after successful reconciliation when there is no checkout', async () => {
    await expect(syncBillingCheckout({
      userId: 'user-1', requestId: 'request-1',
    }, syncClient(null))).resolves.toEqual({ status: 'SYNCHRONIZED', attempt: null });
  });

  it('preserves reconciliation failure reasons while checkout remains pending', async () => {
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({ kind: 'FAILED' });
    await expect(syncBillingCheckout({
      userId: 'user-1', requestId: 'request-1', checkoutAttemptId: 'attempt-1',
    }, syncClient(checkoutAttempt('VERIFICATION_PENDING')))).resolves.toMatchObject({
      status: 'PENDING', reason: 'failed', attempt: { status: 'VERIFICATION_PENDING' },
    });
  });
});
