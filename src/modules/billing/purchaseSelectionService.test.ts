import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBillingAccount: vi.fn(),
  getActiveBillingCatalog: vi.fn(),
  configureRawQuerySchema: vi.fn(),
}));

vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: mocks.configureRawQuerySchema }));
vi.mock('./service', () => ({ ensureBillingAccount: mocks.ensureBillingAccount }));
vi.mock('./catalog', () => ({
  billingEnvironmentForApp: vi.fn(() => 'PREVIEW'),
  getActiveBillingCatalog: mocks.getActiveBillingCatalog,
}));

import { putBillingPurchaseSelection } from './purchaseSelectionService';

const now = new Date('2026-09-25T21:00:00Z');

function projectedSelection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'selection-1',
    logicalProductId: 'tenka_capacity_3',
    billingInterval: 'MONTHLY',
    targetCapacity: 3,
    status: 'DRAFT',
    version: 1,
    lockedAt: null,
    createdAt: now,
    updatedAt: now,
    items: [
      { slotNumber: 1, divisionIdSnapshot: 'division-free' },
      { slotNumber: 2, divisionIdSnapshot: 'division-paid' },
    ],
    ...overrides,
  };
}

function catalog() {
  return {
    available: true,
    environment: 'PREVIEW',
    purchasesEnabled: false,
    release: {
      id: 'release-1', version: 'v1',
      products: [
        { logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY', capacity: 3, store: 'APPLE' },
        { logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY', capacity: 3, store: 'GOOGLE' },
      ],
    },
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    billingPurchaseSelection: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(projectedSelection()),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    billingPurchaseSelectionItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    freeManagementGrant: {
      findFirst: vi.fn().mockResolvedValue({
        divisionId: 'division-free', divisionIdSnapshot: 'division-free',
      }),
    },
    billingAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'division-free' }, { id: 'division-paid' }]),
    ...overrides,
  };
}

describe('billing purchase selection service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureBillingAccount.mockResolvedValue({ id: 'billing-1' });
    mocks.getActiveBillingCatalog.mockResolvedValue(catalog());
  });

  it('derives capacity from the catalog and reserves the free division in slot one', async () => {
    const tx = transaction();
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    const result = await putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
        divisionIds: ['division-paid'], expectedVersion: 0,
      },
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client);

    expect(tx.billingPurchaseSelection.create).toHaveBeenCalledWith({
      data: {
        billingAccountId: 'billing-1', logicalProductId: 'tenka_capacity_3',
        billingInterval: 'MONTHLY', targetCapacity: 3,
        items: { createMany: { data: [
          { slotNumber: 1, divisionIdSnapshot: 'division-free' },
          { slotNumber: 2, divisionIdSnapshot: 'division-paid' },
        ] } },
      },
      select: expect.any(Object),
    });
    expect(result.items[0]).toEqual({
      slotNumber: 1, divisionId: 'division-free', fixedByFreeGrant: true,
    });
    const audit = tx.billingAuditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'BILLING_PURCHASE_SELECTION_CREATED', targetId: 'selection-1' });
    expect(JSON.stringify(audit.metadataRedacted)).not.toContain('division-free');
    expect(JSON.stringify(audit.metadataRedacted)).not.toContain('division-paid');
  });

  it('rejects a client attempt to include the fixed free division', async () => {
    const tx = transaction();
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
        divisionIds: ['division-free'], expectedVersion: 0,
      },
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).rejects.toThrow('ocupa automáticamente el slot 1');
    expect(tx.billingPurchaseSelection.create).not.toHaveBeenCalled();
  });

  it('fails with a stable conflict when checkout already locked the selection', async () => {
    const tx = transaction({
      billingPurchaseSelection: {
        findFirst: vi.fn().mockResolvedValue(projectedSelection({ status: 'LOCKED', lockedAt: now })),
        create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(),
      },
    });
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
        divisionIds: [], expectedVersion: 1,
      },
      actor: { userId: 'user-1', requestId: 'request-1' },
    }, client)).rejects.toMatchObject({ statusCode: 409, code: 'BILLING_SELECTION_LOCKED' });
  });
});
