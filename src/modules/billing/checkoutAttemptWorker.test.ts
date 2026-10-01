import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configureRawQuerySchema: vi.fn(),
  acquireBillingAccountLock: vi.fn(),
  assertCanonicalBillingIdentity: vi.fn(),
  reconcilePeriodicCandidateNow: vi.fn(),
  captureMessage: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: mocks.configureRawQuerySchema }));
vi.mock('./service', () => ({ acquireBillingAccountLock: mocks.acquireBillingAccountLock }));
vi.mock('./canonicalIdentity', () => ({ assertCanonicalBillingIdentity: mocks.assertCanonicalBillingIdentity }));
vi.mock('./periodicReconciliationWorker', () => ({ reconcilePeriodicCandidateNow: mocks.reconcilePeriodicCandidateNow }));
vi.mock('../../instrument', () => ({ Sentry: { captureMessage: mocks.captureMessage } }));
vi.mock('../../config/logger', () => ({ logger: { warn: mocks.warn } }));

import { checkoutAttemptWorkerInternals, processCheckoutAttempts } from './checkoutAttemptWorker';

const claimed = {
  id: 'attempt-1',
  billingAccountId: 'billing-1',
  purchaseSelectionId: 'selection-1',
  status: 'CANCEL_REPORTED' as const,
  startedAt: new Date('2026-09-26T10:00:00Z'),
  lastVerificationAt: new Date('2026-09-26T10:01:00Z'),
  lastErrorCode: null,
};

function cancellationTransaction(
  evidence: { id: string } | null = null,
  status: 'CANCEL_REPORTED' | 'PREPARED' = 'CANCEL_REPORTED',
) {
  return {
    billingCheckoutAttempt: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'attempt-1', status, version: 2, lockedBy: 'worker-1',
        logicalProductIdSnapshot: 'tenka_capacity_2', billingIntervalSnapshot: 'MONTHLY',
        targetCapacitySnapshot: 2, storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
      }),
      update: vi.fn(),
    },
    billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue(evidence) },
    billingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    billingPurchaseSelection: {
      findUnique: vi.fn().mockResolvedValue({
        version: 4, status: 'LOCKED', checkoutAttemptId: 'attempt-1',
      }),
      update: vi.fn(),
    },
    billingAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ now: new Date('2026-09-26T10:05:00Z') }]),
  };
}

describe('checkout attempt worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reopens the selection only after canonical reconciliation finds no active evidence', async () => {
    const tx = cancellationTransaction();
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    await expect(checkoutAttemptWorkerInternals.confirmCancellation(
      claimed, 'worker-1', client,
    )).resolves.toBe(true);

    expect(mocks.acquireBillingAccountLock).toHaveBeenCalledWith(tx, 'billing-1');
    expect(tx.billingPurchaseSelection.update).toHaveBeenCalledWith({
      where: { id: 'selection-1' },
      data: { status: 'DRAFT', lockedAt: null, checkoutAttemptId: null, version: { increment: 1 } },
    });
    expect(tx.billingCheckoutAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ status: 'CANCELED', terminalAt: expect.any(Date), nextVerificationAt: null }),
    });
    expect(tx.billingAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'BILLING_CHECKOUT_ATTEMPT_COMPLETED', metadataRedacted: {
        resultingStatus: 'CANCELED', selectionVersion: 5,
      },
    }) });
  });

  it('keeps the selection locked when canonical active evidence exists', async () => {
    const tx = cancellationTransaction({ id: 'subscription-1' });
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    await expect(checkoutAttemptWorkerInternals.confirmCancellation(
      claimed, 'worker-1', client,
    )).resolves.toBe(false);
    expect(tx.billingPurchaseSelection.update).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.update).not.toHaveBeenCalled();
  });

  it('keeps the selection locked when an expired materialized purchase proves checkout occurred', async () => {
    const tx = cancellationTransaction();
    tx.billingPeriod.findFirst.mockResolvedValue({ id: 'historical-period-1' });
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(checkoutAttemptWorkerInternals.confirmCancellation(
      claimed, 'worker-1', client,
    )).resolves.toBe(false);
    expect(tx.billingPurchaseSelection.update).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.update).not.toHaveBeenCalled();
  });

  it('abandons a stale prepared attempt only after proving there is no canonical purchase', async () => {
    const tx = cancellationTransaction(null, 'PREPARED');
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    await expect(checkoutAttemptWorkerInternals.abandonPreparedAttempt(
      { ...claimed, status: 'PREPARED' }, 'worker-1', client,
    )).resolves.toBe(true);
    expect(tx.billingCheckoutAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ status: 'ABANDONED', nextVerificationAt: null }),
    });
    expect(tx.billingPurchaseSelection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DRAFT', checkoutAttemptId: null }),
    }));
  });

  it('terminalizes only a canonically confirmed SDK ownership conflict', async () => {
    const tx = {
      billingCheckoutAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'VERIFICATION_PENDING', lockedBy: 'worker-1',
          lastErrorCode: 'sdk_ownership_conflict', version: 3,
        }),
        update: vi.fn(),
      },
      billingPurchaseSelection: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'LOCKED', checkoutAttemptId: 'attempt-1', version: 4,
        }),
        update: vi.fn(),
      },
      billingVerification: {
        findUnique: vi.fn().mockResolvedValue({ id: 'verification-1', status: 'PENDING' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingAuditLog: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([{ now: new Date('2026-09-26T10:05:00Z') }]),
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(checkoutAttemptWorkerInternals.closeCanonicalOwnershipConflict(
      { ...claimed, lastErrorCode: 'sdk_ownership_conflict' }, 'worker-1', client,
    )).resolves.toBe(true);
    expect(tx.billingPurchaseSelection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DRAFT', checkoutAttemptId: null }),
    }));
    expect(tx.billingVerification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'OWNERSHIP_CONFLICT', lastErrorCode: 'canonical_unsafe_ownership' }),
    }));
    expect(tx.billingCheckoutAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'OWNERSHIP_CONFLICT', nextVerificationAt: null }),
    }));
  });

  it('keeps ambiguous SDK ownership reports pending', async () => {
    const transaction = vi.fn();
    const client = { $transaction: transaction } as never;
    await expect(checkoutAttemptWorkerInternals.closeCanonicalOwnershipConflict(
      claimed, 'worker-1', client,
    )).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('releases the lease with backoff when canonical verification fails', async () => {
    const claimTx = {
      $queryRaw: vi.fn().mockResolvedValue([claimed]),
      billingVerification: { updateMany: vi.fn() },
    };
    const rescheduleTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      billingVerification: { updateMany: vi.fn() },
    };
    const client = {
      $transaction: vi.fn()
        .mockImplementationOnce((callback) => callback(claimTx))
        .mockImplementationOnce((callback) => callback(rescheduleTx)),
      billingCheckoutAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never;
    mocks.assertCanonicalBillingIdentity.mockRejectedValue(new Error('provider unavailable'));

    await expect(processCheckoutAttempts(1, client)).resolves.toEqual({
      processedCount: 1, nextDueAt: null,
    });
    expect(rescheduleTx.$executeRaw).toHaveBeenCalledOnce();
    expect(claimTx.billingVerification.updateMany).toHaveBeenCalledWith({
      where: { checkoutAttemptId: 'attempt-1', status: 'PENDING' },
      data: {
        lastAttemptAt: claimed.lastVerificationAt,
        attemptCount: { increment: 1 },
        lastErrorCode: null,
      },
    });
    expect(rescheduleTx.billingVerification.updateMany).toHaveBeenCalledWith({
      where: { checkoutAttemptId: 'attempt-1', status: 'PENDING' },
      data: { lastErrorCode: 'verification_failed' },
    });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'billing.checkout_verification_deferred', status: 'CANCEL_REPORTED',
    }), 'Billing checkout verification deferred');
  });
});
