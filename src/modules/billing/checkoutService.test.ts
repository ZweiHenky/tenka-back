import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  ensureBillingAccount: vi.fn(),
  getActiveBillingCatalog: vi.fn(),
  configureRawQuerySchema: vi.fn(),
  assertCanonicalBillingIdentity: vi.fn(),
  reconcilePeriodicCandidateNow: vi.fn(),
  acquireBillingAccountLock: vi.fn(),
  env: { APP_ENV: 'preview', BILLING_REVENUECAT_ENABLED: true },
}));

vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../config/env', () => ({ env: mocks.env }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: mocks.configureRawQuerySchema }));
vi.mock('./service', () => ({
  ensureBillingAccount: mocks.ensureBillingAccount,
  acquireBillingAccountLock: mocks.acquireBillingAccountLock,
}));
vi.mock('./canonicalIdentity', () => ({ assertCanonicalBillingIdentity: mocks.assertCanonicalBillingIdentity }));
vi.mock('./catalog', () => ({
  billingEnvironmentForApp: vi.fn(() => 'PREVIEW'),
  getActiveBillingCatalog: mocks.getActiveBillingCatalog,
}));
vi.mock('./periodicReconciliationWorker', () => ({ reconcilePeriodicCandidateNow: mocks.reconcilePeriodicCandidateNow }));
vi.mock('../../workers/jobSignals', () => ({ signalBackgroundJob: vi.fn() }));

import {
  abandonPreviewBillingCheckout,
  reportBillingCheckoutOutcome,
  startBillingCheckout,
  syncBillingCheckout,
} from './checkoutService';

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
    billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    billingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    billingLocalGrace: { findFirst: vi.fn().mockResolvedValue(null) },
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

function abandonClient(current: ReturnType<typeof checkoutAttempt>, databaseNow: Date) {
  const projected = { ...current, billingAccountId: 'billing-1', lockedBy: null, leaseUntil: null };
  const tx = {
    billingCheckoutAttempt: {
      findFirst: vi.fn().mockResolvedValue(projected),
      update: vi.fn().mockResolvedValue({ ...current, status: 'ABANDONED', version: current.version + 1 }),
    },
    billingAuditLog: { findFirst: vi.fn().mockResolvedValue(null), createMany: vi.fn() },
    billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    billingTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    billingProviderPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    billingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    billingPurchaseSelection: {
      findUnique: vi.fn().mockResolvedValue({ status: 'LOCKED', checkoutAttemptId: current.id, version: 4 }),
      update: vi.fn(),
    },
    billingVerification: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'verification-1', status: 'PENDING', providerSubscriptionChainId: null, providerTransactionId: null,
      }),
      update: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ now: databaseNow }]),
  };
  const client = {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
    billingCheckoutAttempt: { findFirst: vi.fn().mockResolvedValue(current) },
    billingAuditLog: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((callback) => callback(tx)),
  };
  return { client: client as never, tx };
}

describe('billing checkout service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureBillingAccount.mockResolvedValue({ id: 'billing-1' });
    mocks.getActiveBillingCatalog.mockResolvedValue(catalog());
    mocks.assertCanonicalBillingIdentity.mockResolvedValue(undefined);
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({ kind: 'SUCCESS' });
    mocks.env.APP_ENV = 'preview';
    mocks.env.BILLING_REVENUECAT_ENABLED = true;
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

  it.each([
    ['an active provider subscription', 'billingProviderSubscription'],
    ['a current store period', 'billingPeriod'],
    ['an active local grace', 'billingLocalGrace'],
  ] as const)('rejects a new initial checkout when the account has %s', async (_, delegate) => {
    const tx = transaction();
    tx[delegate].findFirst.mockResolvedValueOnce({ id: `${delegate}-1` });
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(startBillingCheckout({
      checkout: { purchaseSelectionId: 'selection-1', expectedVersion: 3, store: 'GOOGLE' },
      idempotencyKey: 'checkout-start-2',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).rejects.toMatchObject({ code: 'BILLING_INITIAL_PURCHASE_NOT_ALLOWED', statusCode: 409 });

    expect(mocks.getActiveBillingCatalog).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.create).not.toHaveBeenCalled();
    expect(tx.billingPurchaseSelection.updateMany).not.toHaveBeenCalled();
    expect(tx.billingAuditLog.create).not.toHaveBeenCalled();
  });

  it('returns an idempotent prior attempt before checking current paid access', async () => {
    const tx = transaction();
    const checkout = { purchaseSelectionId: 'selection-1', expectedVersion: 3, store: 'GOOGLE' as const };
    tx.billingCheckoutAttempt.findUnique.mockResolvedValueOnce({
      ...checkoutAttempt('VERIFIED'),
      requestFingerprint: createHash('sha256').update(JSON.stringify(checkout)).digest('hex'),
    });
    tx.billingProviderSubscription.findFirst.mockResolvedValueOnce({ id: 'subscription-1' });
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(startBillingCheckout({
      checkout,
      idempotencyKey: 'checkout-start-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).resolves.toMatchObject({ id: 'attempt-1', status: 'VERIFIED' });

    expect(tx.billingProviderSubscription.findFirst).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.create).not.toHaveBeenCalled();
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

  it('returns the authoritative verified attempt after reconciliation', async () => {
    const initial = checkoutAttempt('VERIFICATION_PENDING');
    const verified = { ...checkoutAttempt('VERIFIED'), version: 3 };
    const { client, tx } = abandonClient(verified, new Date('2026-09-26T12:00:00Z'));
    (client as any).billingCheckoutAttempt.findFirst.mockResolvedValue(initial);
    tx.billingCheckoutAttempt.findFirst.mockResolvedValue(verified);
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({
      kind: 'SUCCESS', result: { subscriptionsObserved: 1, issues: [] },
    });

    await expect(abandonPreviewBillingCheckout({
      attemptId: initial.id, abandon: { expectedVersion: initial.version }, idempotencyKey: 'abandon-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).resolves.toMatchObject({ status: 'SYNCHRONIZED', attempt: { status: 'VERIFIED', version: 3 } });
    expect(tx.billingVerification.update).not.toHaveBeenCalled();
  });

  it('keeps a recent attempt pending during the settlement window', async () => {
    const initial = checkoutAttempt('VERIFICATION_PENDING');
    const { client, tx } = abandonClient(initial, new Date('2026-09-26T10:30:00Z'));
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({
      kind: 'SUCCESS', result: { subscriptionsObserved: 0, issues: [] },
    });

    await expect(abandonPreviewBillingCheckout({
      attemptId: initial.id, abandon: { expectedVersion: initial.version }, idempotencyKey: 'abandon-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).resolves.toMatchObject({ status: 'PENDING', reason: 'settlement_window' });
    expect(tx.billingTransaction.findFirst).not.toHaveBeenCalled();
    expect(tx.billingVerification.update).not.toHaveBeenCalled();
  });

  it('atomically abandons an old attempt only when exact commercial evidence is absent', async () => {
    const initial = checkoutAttempt('VERIFICATION_PENDING');
    const { client, tx } = abandonClient(initial, new Date('2026-09-26T12:00:00Z'));
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({
      kind: 'SUCCESS', result: { subscriptionsObserved: 0, issues: [] },
    });

    await expect(abandonPreviewBillingCheckout({
      attemptId: initial.id, abandon: { expectedVersion: initial.version }, idempotencyKey: 'abandon-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).resolves.toMatchObject({ status: 'ABANDONED', attempt: { version: 3 } });
    expect(tx.billingVerification.update).toHaveBeenCalledWith({
      where: { id: 'verification-1' },
      data: {
        status: 'REJECTED', lastAttemptAt: new Date('2026-09-26T12:00:00Z'),
        attemptCount: { increment: 1 }, lastErrorCode: 'preview_abandoned_no_commercial_evidence',
      },
    });
    expect(tx.billingPurchaseSelection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DRAFT', checkoutAttemptId: null }),
    }));
    expect(tx.billingAuditLog.createMany).toHaveBeenCalledOnce();
  });

  it('does not abandon when the exact product already has an active sandbox subscription', async () => {
    const initial = checkoutAttempt('VERIFICATION_PENDING');
    const { client, tx } = abandonClient(initial, new Date('2026-09-26T12:00:00Z'));
    tx.billingProviderSubscription.findFirst.mockResolvedValue({ id: 'subscription-1' });
    mocks.reconcilePeriodicCandidateNow.mockResolvedValue({
      kind: 'SUCCESS', result: { subscriptionsObserved: 1, issues: [] },
    });

    await expect(abandonPreviewBillingCheckout({
      attemptId: initial.id, abandon: { expectedVersion: initial.version }, idempotencyKey: 'abandon-1',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).resolves.toMatchObject({ status: 'PENDING', reason: 'commercial_evidence' });
    expect(tx.billingVerification.update).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.update).not.toHaveBeenCalled();
  });
});
