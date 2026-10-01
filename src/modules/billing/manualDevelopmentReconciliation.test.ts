import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  formatDevelopmentReconciliationResult,
  reconcileRevenueCatSandboxForDevelopment,
} from './manualDevelopmentReconciliation';

const completed = {
  subscriptionsObserved: 1,
  subscriptionsPersisted: 1,
  transactionsCreated: 1,
  periodsCreated: 1,
  issues: [],
};

function clientWithAccount(account: unknown): PrismaClient {
  return {
    billingAccount: { findUnique: vi.fn().mockResolvedValue(account) },
  } as unknown as PrismaClient;
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'billing_account-1',
    detachedAt: null,
    providerIdentities: [{
      revenueCatAppUserId: 'billing_account-1',
      status: 'ACTIVE',
      retiredAt: null,
    }],
    ...overrides,
  };
}

describe('manual development billing reconciliation', () => {
  const originalDevelopmentScriptAuth = process.env.DEVELOPMENT_SCRIPT_AUTH;

  beforeAll(() => { process.env.DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1'; });
  afterAll(() => {
    if (originalDevelopmentScriptAuth === undefined) delete process.env.DEVELOPMENT_SCRIPT_AUTH;
    else process.env.DEVELOPMENT_SCRIPT_AUTH = originalDevelopmentScriptAuth;
  });

  beforeEach(() => vi.clearAllMocks());

  it('cannot bypass the protected development-script context', async () => {
    const client = clientWithAccount(account());
    delete process.env.DEVELOPMENT_SCRIPT_AUTH;
    try {
      await expect(reconcileRevenueCatSandboxForDevelopment('billing_account-1', client))
        .rejects.toThrow('Direct database script execution is disabled');
      expect(client.billingAccount.findUnique).not.toHaveBeenCalled();
    } finally {
      process.env.DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1';
    }
  });

  it('preflights an attached canonical identity and pins reconciliation to local sandbox', async () => {
    const reconcile = vi.fn().mockResolvedValue(completed);
    const schedule = vi.fn().mockResolvedValue(undefined);
    await expect(reconcileRevenueCatSandboxForDevelopment(
      'billing_account-1',
      clientWithAccount(account()),
      { reconcile, schedule },
    )).resolves.toEqual(completed);

    expect(reconcile).toHaveBeenCalledWith('billing_account-1', expect.objectContaining({
      appEnvironment: 'local',
      getCatalog: expect.any(Function),
      getCustomer: expect.any(Function),
      persistLedger: expect.any(Function),
    }));
    expect(schedule).toHaveBeenCalledWith('billing_account-1', 1440, expect.any(Object));
  });

  it('allows a coherent retired canonical identity for a detached account', async () => {
    const reconcile = vi.fn().mockResolvedValue(completed);
    await expect(reconcileRevenueCatSandboxForDevelopment(
      'billing_account-1',
      clientWithAccount(account({
        detachedAt: new Date('2026-09-01T00:00:00Z'),
        providerIdentities: [{
          revenueCatAppUserId: 'billing_account-1',
          status: 'RETIRED',
          retiredAt: new Date('2026-09-01T00:00:00Z'),
        }],
      })),
      { reconcile, schedule: vi.fn() },
    )).resolves.toEqual(completed);
  });

  it('does not enroll an account when the manual check finds no commercial evidence', async () => {
    const schedule = vi.fn();
    await reconcileRevenueCatSandboxForDevelopment(
      'billing_account-1',
      clientWithAccount(account()),
      {
        reconcile: vi.fn().mockResolvedValue({
          subscriptionsObserved: 0,
          subscriptionsPersisted: 0,
          transactionsCreated: 0,
          periodsCreated: 0,
          issues: [],
        }),
        schedule,
      },
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it('rejects a missing account before provider reconciliation', async () => {
    const reconcile = vi.fn();
    await expect(reconcileRevenueCatSandboxForDevelopment(
      'billing_missing',
      clientWithAccount(null),
      { reconcile },
    )).rejects.toMatchObject({ statusCode: 404 });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    { providerIdentities: [] },
    { providerIdentities: [account().providerIdentities[0], account().providerIdentities[0]] },
    { providerIdentities: [{ ...account().providerIdentities[0], revenueCatAppUserId: 'billing_other' }] },
    { providerIdentities: [{ ...account().providerIdentities[0], status: 'RETIRED', retiredAt: new Date() }] },
    {
      detachedAt: new Date(),
      providerIdentities: [{ ...account().providerIdentities[0], status: 'ACTIVE', retiredAt: null }],
    },
  ])('rejects an incoherent canonical identity %#', async (overrides) => {
    const reconcile = vi.fn();
    await expect(reconcileRevenueCatSandboxForDevelopment(
      'billing_account-1',
      clientWithAccount(account(overrides)),
      { reconcile },
    )).rejects.toMatchObject({ statusCode: 409, code: 'BILLING_CANONICAL_IDENTITY_INVALID' });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('formats only aggregate evidence and marks blocking results', () => {
    const output = formatDevelopmentReconciliationResult({
      ...completed,
      issues: [{ code: 'ENTITLEMENT_MISMATCH', severity: 'BLOCKING', count: 1 }],
    });
    expect(output).toContain('completed with blocking issues');
    expect(output).toContain('BLOCKING:ENTITLEMENT_MISMATCH=1');
    expect(output).toContain('purchasesEnabled=false');
    expect(output).not.toContain('billing_account-1');
  });
});
