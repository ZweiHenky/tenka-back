import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  ensureBillingAccount: vi.fn(),
  acquireBillingAccountLock: vi.fn(),
  getActiveBillingCatalog: vi.fn(),
  resolvePaidAccessShadowInTransaction: vi.fn(),
  configureRawQuerySchema: vi.fn(),
  env: { APP_ENV: 'preview', BILLING_REVENUECAT_ENABLED: false },
}));

vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../config/env', () => ({ env: mocks.env }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: mocks.configureRawQuerySchema }));
vi.mock('./service', () => ({
  ensureBillingAccount: mocks.ensureBillingAccount,
  acquireBillingAccountLock: mocks.acquireBillingAccountLock,
}));
vi.mock('./catalog', () => ({
  billingEnvironmentForApp: vi.fn(() => 'PREVIEW'),
  getActiveBillingCatalog: mocks.getActiveBillingCatalog,
}));
vi.mock('./paidAccessShadow', () => ({
  resolvePaidAccessShadowInTransaction: mocks.resolvePaidAccessShadowInTransaction,
}));

import {
  abandonBillingChangeOperation,
  classifyBillingChange,
  confirmBillingChange,
  confirmBillingChangeFinalStep,
  previewBillingChange,
} from './changePreviewService';
import { resolveBillingChangeNextAction, resolveBillingChangeOperationState } from './changeOperationState';

const now = new Date('2026-10-07T12:00:00Z');

const INTERVALS = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;

function catalogProduct(capacity: number, billingInterval: string, store: 'APPLE' | 'GOOGLE') {
  return {
    id: `variant-${store.toLowerCase()}-${capacity}-${billingInterval.toLowerCase()}`,
    logicalProductId: `tenka_capacity_${capacity}`,
    billingInterval,
    capacity,
    store,
    storeProductId: `tenka_capacity_${capacity}`,
    basePlanId: store === 'GOOGLE' ? billingInterval.toLowerCase() : null,
    revenueCatOfferingId: `capacity_${capacity}`,
    revenueCatPackageId: '$rc_monthly',
    revenueCatProductIdentifier: `tenka_capacity_${capacity}`,
    intervalMonths: 1,
    active: true,
  };
}

function catalog(purchasesEnabled = true) {
  const products: ReturnType<typeof catalogProduct>[] = [];
  for (const capacity of [2, 3, 6]) {
    for (const interval of INTERVALS) {
      for (const store of ['APPLE', 'GOOGLE'] as const) {
        products.push(catalogProduct(capacity, interval, store));
      }
    }
  }
  return {
    available: true,
    environment: 'PREVIEW',
    purchasesEnabled,
    release: { id: 'release-1', version: 'v1', products },
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    billingChangeOperation: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'operation-1', status: 'FIRST_PURCHASE_PENDING', version: 1 }),
      update: vi.fn().mockResolvedValue({ id: 'operation-1', status: 'ABANDONED', version: 2 }),
    },
    billingCheckoutAttempt: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'attempt-1', status: 'PREPARED', purpose: 'PRODUCT_CHANGE_FIRST_STEP', version: 1,
        logicalProductIdSnapshot: 'tenka_capacity_6', billingIntervalSnapshot: 'MONTHLY',
        targetCapacitySnapshot: 6, offeringIdSnapshot: 'capacity_6', packageIdSnapshot: '$rc_monthly',
        storeProductIdSnapshot: 'tenka_capacity_6', basePlanIdSnapshot: 'monthly',
        revenueCatProductIdentifierSnapshot: 'tenka_capacity_6:monthly',
        startedAt: now, nextVerificationAt: new Date('2026-10-07T12:05:00Z'),
      }),
    },
    billingProductCatalog: {
      findUnique: vi.fn().mockResolvedValue({ logicalProductId: 'tenka_capacity_6', billingInterval: 'ANNUAL' }),
    },
    billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    billingPeriod: { findFirst: vi.fn().mockResolvedValue(currentPeriod()) },
    billingAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ now, verificationAt: new Date('2026-10-07T12:05:00Z') }]),
    ...overrides,
  };
}

function client(tx: unknown) {
  return { $transaction: vi.fn((callback) => callback(tx)) } as never;
}

function googleSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'subscription-1',
    store: 'GOOGLE',
    providerSubscriptionChainId: 'chain-1',
    currentLogicalProductId: 'tenka_capacity_3',
    currentBillingInterval: 'MONTHLY',
    ...overrides,
  };
}

function currentPeriod(subscription = googleSubscription(), storeEnvironment = 'SANDBOX') {
  return {
    primaryProviderPeriod: {
      store: subscription.store,
      storeEnvironment,
      billingInterval: subscription.currentBillingInterval,
      subscription,
    },
  };
}

function persistedVariants() {
  return {
    sourceVariant: catalogProduct(3, 'MONTHLY', 'GOOGLE'),
    intermediateVariant: catalogProduct(6, 'MONTHLY', 'GOOGLE'),
    targetVariant: catalogProduct(6, 'ANNUAL', 'GOOGLE'),
  };
}

function paid(capacity: number, assignedCount = 1) {
  return {
    state: 'PAID',
    capacity,
    assignments: Array.from({ length: assignedCount }, (_, index) => ({
      slotNumber: index + 1,
      divisionId: `division-${index + 1}`,
      divisionIdSnapshot: `division-${index + 1}`,
      assignedAt: now,
    })),
  };
}

const upgradeInput = (logicalProductId: string, billingInterval = 'MONTHLY') => ({
  change: { logicalProductId, billingInterval } as never,
  actor: { userId: 'user-1', requestId: 'request-1' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureBillingAccount.mockResolvedValue({ id: 'billing-1' });
  mocks.acquireBillingAccountLock.mockResolvedValue(undefined);
  mocks.getActiveBillingCatalog.mockResolvedValue(catalog());
  mocks.resolvePaidAccessShadowInTransaction.mockResolvedValue(paid(3, 1));
});

describe('classifyBillingChange', () => {
  it('classifies immediate, two-step and deferred directions', () => {
    expect(classifyBillingChange('GOOGLE', { capacity: 3, billingInterval: 'MONTHLY' }, { capacity: 6, billingInterval: 'MONTHLY' }))
      .toEqual({ direction: 'UPGRADE', timing: 'IMMEDIATE' });
    expect(classifyBillingChange('GOOGLE', { capacity: 3, billingInterval: 'MONTHLY' }, { capacity: 6, billingInterval: 'ANNUAL' }))
      .toEqual({ direction: 'UPGRADE', timing: 'TWO_STEP' });
    expect(classifyBillingChange('APPLE', { capacity: 3, billingInterval: 'MONTHLY' }, { capacity: 6, billingInterval: 'ANNUAL' }))
      .toEqual({ direction: 'UPGRADE', timing: 'IMMEDIATE' });
    expect(classifyBillingChange('GOOGLE', { capacity: 6, billingInterval: 'MONTHLY' }, { capacity: 3, billingInterval: 'MONTHLY' }))
      .toEqual({ direction: 'DOWNGRADE', timing: 'DEFERRED' });
    expect(classifyBillingChange('GOOGLE', { capacity: 3, billingInterval: 'MONTHLY' }, { capacity: 3, billingInterval: 'ANNUAL' }))
      .toEqual({ direction: 'SAME', timing: 'DEFERRED' });
    expect(classifyBillingChange('GOOGLE', { capacity: 3, billingInterval: 'MONTHLY' }, { capacity: 3, billingInterval: 'MONTHLY' }))
      .toEqual({ direction: 'SAME', timing: null });
  });
});

describe('previewBillingChange', () => {
  it('rejects a non league actor', async () => {
    const tx = transaction({ user: { findUnique: vi.fn().mockResolvedValue({ rol: 'CAPITAN' }) } });
    await expect(previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx))).rejects.toThrow('rol LIGA');
  });

  it('pauses when purchases are disabled', async () => {
    mocks.getActiveBillingCatalog.mockResolvedValue(catalog(false));
    const tx = transaction();
    await expect(previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx)))
      .rejects.toMatchObject({ statusCode: 409, code: 'BILLING_PURCHASES_PAUSED' });
  });

  it('reports no paid access without touching the catalog target', async () => {
    mocks.resolvePaidAccessShadowInTransaction.mockResolvedValue({ state: 'NONE', reason: 'NO_CURRENT_PERIOD' });
    const tx = transaction();
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx));
    expect(result).toMatchObject({
      eligible: false,
      reason: 'NO_PAID_ACCESS',
      store: 'GOOGLE',
      direction: null,
      timing: null,
      operationId: null,
    });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });

  it('reports blocked provider evidence as invalid', async () => {
    mocks.resolvePaidAccessShadowInTransaction.mockResolvedValue({ state: 'BLOCKED', reason: 'invalid_capacity' });
    const tx = transaction({ billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue(googleSubscription()) } });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx));
    expect(result).toMatchObject({ eligible: false, reason: 'EVIDENCE_INVALID' });
  });

  it('does not allow changes while access comes from local grace', async () => {
    mocks.resolvePaidAccessShadowInTransaction.mockResolvedValue({
      state: 'LOCAL_GRACE', capacity: 3, graceEndsAt: now, assignments: [],
    });
    const tx = transaction({
      billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue({ store: 'GOOGLE' }) },
    });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx));
    expect(result).toMatchObject({ eligible: false, reason: 'LOCAL_GRACE' });
  });

  it('uses the effective period primary subscription instead of the latest provider row', async () => {
    const tx = transaction({
      billingProviderSubscription: {
        findFirst: vi.fn().mockResolvedValue(googleSubscription({ currentLogicalProductId: 'tenka_capacity_6' })),
      },
    });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_3'), client(tx));
    expect(result).toMatchObject({ eligible: false, reason: 'NO_CHANGE', current: { capacity: 3 } });
    expect(tx.billingProviderSubscription.findFirst).not.toHaveBeenCalled();
  });

  it('reports the same variant as a no-op', async () => {
    const tx = transaction();
    const result = await previewBillingChange(upgradeInput('tenka_capacity_3'), client(tx));
    expect(result).toMatchObject({
      eligible: false,
      reason: 'NO_CHANGE',
      direction: 'SAME',
      timing: null,
      current: { logicalProductId: 'tenka_capacity_3', capacity: 3 },
    });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });

  it('creates no operation for an immediate capacity upgrade', async () => {
    const tx = transaction();
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx));
    expect(result).toMatchObject({
      eligible: true,
      reason: null,
      direction: 'UPGRADE',
      timing: 'IMMEDIATE',
      firstStep: null,
      operationId: null,
      operationStatus: null,
      requiresRenewalSelection: false,
      current: { logicalProductId: 'tenka_capacity_3' },
      target: { logicalProductId: 'tenka_capacity_6', capacity: 6 },
    });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });

  it('returns the intermediate variant without persisting a preview-only operation', async () => {
    const tx = transaction();
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6', 'ANNUAL'), client(tx));
    expect(result).toMatchObject({
      eligible: true,
      direction: 'UPGRADE',
      timing: 'TWO_STEP',
      firstStep: { logicalProductId: 'tenka_capacity_6', billingInterval: 'MONTHLY', capacity: 6 },
      operationId: null,
      operationStatus: null,
    });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
    expect(tx.billingAuditLog.create).not.toHaveBeenCalled();
  });

  it('blocks a second change while another operation is active on the chain', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ id: 'operation-active' }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(previewBillingChange(upgradeInput('tenka_capacity_6', 'ANNUAL'), client(tx)))
      .rejects.toMatchObject({ statusCode: 409, code: 'BILLING_CHANGE_IN_PROGRESS' });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });

  it('keeps preview independent from an idempotency key and returns a deterministic fingerprint', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6', 'ANNUAL'), client(tx));
    const repeated = await previewBillingChange(upgradeInput('tenka_capacity_6', 'ANNUAL'), client(tx));
    expect(result).toMatchObject({ operationId: null, operationStatus: null });
    expect(result.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(repeated.previewFingerprint).toBe(result.previewFingerprint);
    expect(tx.billingChangeOperation.findUnique).not.toHaveBeenCalled();
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });

  it('does not consult persisted operations by preview idempotency key', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'operation-1', status: 'DRAFT', requestFingerprint: 'f'.repeat(64), ...persistedVariants(),
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx)))
      .resolves.toMatchObject({ eligible: true, operationId: null });
    expect(tx.billingChangeOperation.findUnique).not.toHaveBeenCalled();
  });

  it('requires a renewal selection when the downgrade no longer covers assigned divisions', async () => {
    mocks.resolvePaidAccessShadowInTransaction.mockResolvedValue(paid(6, 6));
    const tx = transaction({
      billingPeriod: {
        findFirst: vi.fn().mockResolvedValue(currentPeriod(googleSubscription({
          currentLogicalProductId: 'tenka_capacity_6',
          currentBillingInterval: 'MONTHLY',
        }))),
      },
    });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_3'), client(tx));
    expect(result).toMatchObject({
      eligible: true,
      direction: 'DOWNGRADE',
      timing: 'DEFERRED',
      requiresRenewalSelection: true,
      operationId: null,
    });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });

  it('ignores tombstoned assignments when deciding if renewal selection is required', async () => {
    const access = paid(6, 4);
    access.assignments[2].divisionId = null as never;
    access.assignments[3].divisionId = null as never;
    mocks.resolvePaidAccessShadowInTransaction.mockResolvedValue(access);
    const tx = transaction({
      billingPeriod: {
        findFirst: vi.fn().mockResolvedValue(currentPeriod(googleSubscription({
          currentLogicalProductId: 'tenka_capacity_6',
          currentBillingInterval: 'MONTHLY',
        }))),
      },
    });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_3'), client(tx));
    expect(result).toMatchObject({ direction: 'DOWNGRADE', requiresRenewalSelection: false });
  });

  it('classifies an Apple upgrade without creating a Google operation', async () => {
    const tx = transaction({
      billingPeriod: {
        findFirst: vi.fn().mockResolvedValue(currentPeriod(googleSubscription({
          id: 'subscription-apple', store: 'APPLE',
        }))),
      },
    });
    const result = await previewBillingChange(upgradeInput('tenka_capacity_6'), client(tx));
    expect(result).toMatchObject({ eligible: true, reason: null, store: 'APPLE', timing: 'IMMEDIATE' });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
  });
});

describe('billing change confirmation', () => {
  it('revalidates a two-step preview and persists the first attempt before store IO', async () => {
    const tx = transaction();
    const preview = await previewBillingChange(upgradeInput('tenka_capacity_6', 'ANNUAL'), client(tx));
    const result = await confirmBillingChange({
      confirm: {
        targetVariantId: preview.target.variantId,
        expectedSourceVariantId: preview.current!.variantId,
        previewFingerprint: preview.previewFingerprint,
      },
      idempotencyKey: 'confirm-key-0001',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx));

    expect(result).toMatchObject({
      operation: { id: 'operation-1', status: 'FIRST_PURCHASE_PENDING', version: 1 },
      attempt: { id: 'attempt-1', purpose: 'PRODUCT_CHANGE_FIRST_STEP' },
      instruction: {
        step: 'FIRST', replacementMode: 'CHARGE_PRORATED_PRICE',
        sourceVariant: { capacity: 3, billingInterval: 'MONTHLY' },
        targetVariant: { capacity: 6, billingInterval: 'MONTHLY' },
      },
    });
    expect(tx.billingChangeOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FIRST_PURCHASE_PENDING', sourceVariantId: 'variant-google-3-monthly',
        intermediateVariantId: 'variant-google-6-monthly', targetVariantId: 'variant-google-6-annual',
      }),
    }));
    expect(tx.billingCheckoutAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        purpose: 'PRODUCT_CHANGE_FIRST_STEP', changeOperationId: 'operation-1',
        logicalProductIdSnapshot: 'tenka_capacity_6', billingIntervalSnapshot: 'MONTHLY',
      }),
    }));
    expect(tx.billingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'BILLING_CHANGE_OPERATION_CONFIRMED' }),
    }));
  });

  it('rejects a stale preview before creating commercial intent', async () => {
    const tx = transaction();
    await expect(confirmBillingChange({
      confirm: {
        targetVariantId: 'variant-google-6-annual',
        expectedSourceVariantId: 'variant-google-3-monthly',
        previewFingerprint: 'f'.repeat(64),
      },
      idempotencyKey: 'confirm-key-0002',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx))).rejects.toMatchObject({ statusCode: 409, code: 'BILLING_CHANGE_PREVIEW_STALE' });
    expect(tx.billingChangeOperation.create).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.create).not.toHaveBeenCalled();
  });

  it('creates only a deferred final-step attempt from SECOND_STEP_PENDING', async () => {
    const variants = persistedVariants();
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: 'operation-1', status: 'SECOND_STEP_PENDING', version: 5,
          intermediateVariant: variants.intermediateVariant,
          targetVariant: { ...variants.targetVariant, catalogReleaseId: 'release-1' },
        }),
        create: vi.fn(), update: vi.fn(),
      },
      billingCheckoutAttempt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'attempt-final', status: 'PREPARED', purpose: 'PRODUCT_CHANGE_FINAL_STEP', version: 1,
          logicalProductIdSnapshot: 'tenka_capacity_6', billingIntervalSnapshot: 'ANNUAL',
          targetCapacitySnapshot: 6, offeringIdSnapshot: 'capacity_6', packageIdSnapshot: '$rc_monthly',
          storeProductIdSnapshot: 'tenka_capacity_6', basePlanIdSnapshot: 'annual',
          revenueCatProductIdentifierSnapshot: 'tenka_capacity_6:annual',
          startedAt: now, nextVerificationAt: new Date('2026-10-07T12:05:00Z'),
        }),
      },
    });
    const result = await confirmBillingChangeFinalStep({
      operation: { operationId: 'operation-1' }, confirm: { expectedVersion: 5 },
      idempotencyKey: 'confirm-final-0001', actor: { userId: 'user-1', requestId: 'request-2' },
    }, client(tx));

    expect(result).toMatchObject({
      attempt: { id: 'attempt-final', purpose: 'PRODUCT_CHANGE_FINAL_STEP' },
      instruction: { step: 'FINAL', replacementMode: 'DEFERRED' },
    });
    expect(tx.billingCheckoutAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        purpose: 'PRODUCT_CHANGE_FINAL_STEP', billingIntervalSnapshot: 'ANNUAL',
      }),
    }));
  });
});

describe('abandonBillingChangeOperation', () => {
  it('abandons only a pending second step and audits it', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'operation-1', status: 'SECOND_STEP_PENDING', version: 5,
            abandonIdempotencyKey: null, abandonRequestFingerprint: null,
          }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'operation-1', status: 'ABANDONED', version: 6 }),
      },
    });
    const result = await abandonBillingChangeOperation({
      operation: { operationId: 'operation-1' },
      idempotencyKey: 'change-key-0002',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx));
    expect(result).toEqual({ id: 'operation-1', status: 'ABANDONED', version: 6 });
    expect(tx.billingChangeOperation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'ABANDONED',
        abandonIdempotencyKey: 'change-key-0002',
        lastErrorCode: 'USER_ABANDONED',
        version: { increment: 1 },
      }),
    }));
    expect(tx.billingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'BILLING_CHANGE_OPERATION_ABANDONED' }),
    }));
  });

  it('refuses to abandon a draft operation', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'operation-1', status: 'DRAFT', version: 1,
            abandonIdempotencyKey: null, abandonRequestFingerprint: null,
          }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(abandonBillingChangeOperation({
      operation: { operationId: 'operation-1' },
      idempotencyKey: 'change-key-0002',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx))).rejects.toMatchObject({
      statusCode: 409, code: 'BILLING_CHANGE_OPERATION_NOT_ABANDONABLE',
    });
    expect(tx.billingChangeOperation.update).not.toHaveBeenCalled();
  });

  it('refuses to abandon while a final-step attempt is active', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'operation-1', status: 'SECOND_STEP_PENDING', version: 5,
            abandonIdempotencyKey: null, abandonRequestFingerprint: null,
          }),
        create: vi.fn(), update: vi.fn(),
      },
      billingCheckoutAttempt: {
        findUnique: vi.fn(), create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ id: 'attempt-final' }),
      },
    });
    await expect(abandonBillingChangeOperation({
      operation: { operationId: 'operation-1' },
      idempotencyKey: 'change-key-0003',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx))).rejects.toMatchObject({
      statusCode: 409, code: 'BILLING_CHANGE_OPERATION_NOT_ABANDONABLE',
    });
    expect(tx.billingChangeOperation.update).not.toHaveBeenCalled();
  });

  it('is idempotent when the operation is already abandoned', async () => {
    const abandonRequestFingerprint = createHash('sha256')
      .update(JSON.stringify({ operationId: 'operation-1', status: 'ABANDONED' }))
      .digest('hex');
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: 'operation-1', status: 'ABANDONED', version: 6, abandonRequestFingerprint,
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    const result = await abandonBillingChangeOperation({
      operation: { operationId: 'operation-1' },
      idempotencyKey: 'change-key-0002',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx));
    expect(result).toEqual({ id: 'operation-1', status: 'ABANDONED', version: 6 });
    expect(tx.billingChangeOperation.update).not.toHaveBeenCalled();
  });

  it('refuses to abandon a completed operation', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'operation-1', status: 'COMPLETED', version: 4,
            abandonIdempotencyKey: null, abandonRequestFingerprint: null,
          }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(abandonBillingChangeOperation({
      operation: { operationId: 'operation-1' },
      idempotencyKey: 'change-key-0002',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx))).rejects.toMatchObject({ statusCode: 409, code: 'BILLING_CHANGE_OPERATION_NOT_ABANDONABLE' });
  });

  it('404s an operation owned by another account', async () => {
    const tx = transaction({
      billingChangeOperation: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(abandonBillingChangeOperation({
      operation: { operationId: 'operation-other' },
      idempotencyKey: 'change-key-0002',
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client(tx))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('resolveBillingChangeNextAction', () => {
  it('never tells a restarted client to repeat a prepared first purchase', async () => {
    const stateClient = {
      billingChangeOperation: { findFirst: vi.fn().mockResolvedValue({
        id: 'operation-1', status: 'FIRST_PURCHASE_PENDING', version: 1, ...persistedVariants(),
        checkoutAttempts: [{
          id: 'attempt-1', status: 'PREPARED', purpose: 'PRODUCT_CHANGE_FIRST_STEP', version: 1,
        }],
      }) },
    };
    await expect(resolveBillingChangeOperationState('billing-1', stateClient)).resolves.toMatchObject({
      nextAction: 'WAIT_FOR_FIRST_VERIFICATION',
      activeChangeOperation: {
        status: 'FIRST_PURCHASE_PENDING',
        activeAttempt: { id: 'attempt-1', purpose: 'PRODUCT_CHANGE_FIRST_STEP' },
      },
    });
  });

  it('asks for a scheduled period change while a second step is pending', async () => {
    const stateClient = {
      billingChangeOperation: { findFirst: vi.fn().mockResolvedValue({
        id: 'operation-1', status: 'SECOND_STEP_PENDING', version: 5, ...persistedVariants(),
      }) },
    };
    await expect(resolveBillingChangeNextAction('billing-1', stateClient)).resolves.toBe('SCHEDULE_PERIOD_CHANGE');
    await expect(resolveBillingChangeOperationState('billing-1', stateClient)).resolves.toMatchObject({
      nextAction: 'SCHEDULE_PERIOD_CHANGE',
      activeChangeOperation: {
        id: 'operation-1', status: 'SECOND_STEP_PENDING', version: 5,
        current: { capacity: 6, billingInterval: 'MONTHLY' },
        firstStep: { capacity: 6, billingInterval: 'MONTHLY' },
        target: { capacity: 6, billingInterval: 'ANNUAL' },
      },
    });
  });

  it('returns null without a pending second step or account', async () => {
    const stateClient = {
      billingChangeOperation: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(resolveBillingChangeNextAction('billing-1', stateClient)).resolves.toBeNull();
    await expect(resolveBillingChangeNextAction(null, stateClient)).resolves.toBeNull();
    await expect(resolveBillingChangeNextAction('billing-1', {})).resolves.toBeNull();
  });
});
