import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';

vi.mock('./paidAccessShadow', () => ({
  resolvePaidAccessShadowInTransaction: vi.fn().mockResolvedValue({ state: 'NONE', reason: 'NO_CURRENT_PERIOD' }),
}));
import {
  bootstrapBillingAccount,
  detachBillingAccount,
  ensureBillingAccount,
  ensureInitialFreeManagementGrant,
  resolveAccountAccessPolicy,
} from './service';

const originalEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
afterEach(() => {
  env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = originalEnforcement;
});

describe('billing free foundation', () => {
  it('returns the existing account under the canonical account lock', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn(),
      billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
    } as any;

    await expect(ensureBillingAccount(tx, 'user-1')).resolves.toEqual({ id: 'billing-1' });
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'billing-owner:user-1',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'billing-account:billing-1',
    );
  });

  it('creates an account and matching canonical RevenueCat identity for a LIGA user', async () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
    const tx = {
      $executeRawUnsafe: vi.fn(),
      billingAccount: { findUnique: vi.fn().mockResolvedValue(null), create },
      user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    } as any;

    const account = await ensureBillingAccount(tx, 'user-1');
    const data = create.mock.calls[0][0].data;
    expect(account.id).toMatch(/^billing_/);
    expect(data).toMatchObject({ id: account.id, userId: 'user-1', ownerUserIdSnapshot: 'user-1' });
    expect(data.providerIdentities.create).toMatchObject({
      revenueCatAppUserId: account.id,
      kind: 'CANONICAL',
      observedAsOriginal: true,
    });
  });

  it('bootstraps a canonical identity and returns purchases disabled', async () => {
    const transactionAccount = { id: 'billing-1' };
    const tx = {
      $executeRawUnsafe: vi.fn(),
      billingAccount: { findUnique: vi.fn().mockResolvedValue(transactionAccount) },
    } as any;
    const client = {
      $transaction: vi.fn((callback) => callback(tx)),
      user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: 'billing-1', freeGrants: [] }),
      },
    } as any;

    await expect(bootstrapBillingAccount('user-1', client)).resolves.toMatchObject({
      role: 'LIGA',
      billingAccountId: 'billing-1',
      revenueCatAppUserId: 'billing-1',
      effectiveCapacity: 1,
      purchasesEnabled: false,
    });
    expect(client.$transaction).toHaveBeenCalledOnce();
  });

  it('rejects bootstrap when the database role is not LIGA', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn(),
      billingAccount: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn().mockResolvedValue({ rol: 'CAPITAN' }) },
    } as any;
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as any;

    await expect(bootstrapBillingAccount('user-1', client))
      .rejects.toThrow('Solo una cuenta con rol LIGA puede tener una cuenta de billing');
  });

  it('materializes the first division as the immutable free grant snapshot', async () => {
    const create = vi.fn();
    const tx = {
      billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
      freeManagementGrant: { findFirst: vi.fn().mockResolvedValue(null), create },
      billingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      division: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: 'division-1',
          nombre: 'Primera',
          liga: { id: 'league-1', nombre: 'Liga Centro' },
        }),
      },
    } as any;

    await ensureInitialFreeManagementGrant(tx, 'user-1', 'division-1');
    expect(create).toHaveBeenCalledWith({ data: {
      userId: 'user-1',
      billingAccountId: 'billing-1',
      divisionId: 'division-1',
      divisionIdSnapshot: 'division-1',
      divisionNameSnapshot: 'Primera',
      leagueId: 'league-1',
      leagueIdSnapshot: 'league-1',
      leagueNameSnapshot: 'Liga Centro',
      source: 'INITIAL_FREE',
    } });
  });

  it('does not infer a free grant when the account already has multiple divisions', async () => {
    const create = vi.fn();
    const tx = {
      billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
      freeManagementGrant: { findFirst: vi.fn().mockResolvedValue(null), create },
      billingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      division: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue({ id: 'division-2', nombre: 'Segunda', liga: { id: 'league-1', nombre: 'Liga' } }),
      },
    } as any;

    await ensureInitialFreeManagementGrant(tx, 'user-1', 'division-2');
    expect(create).not.toHaveBeenCalled();
  });

  it('never reissues the initial free grant after paid history exists', async () => {
    const create = vi.fn();
    const tx = {
      billingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }) },
      freeManagementGrant: { findFirst: vi.fn().mockResolvedValue(null), create },
      billingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'period-1' }) },
      division: { count: vi.fn(), findFirst: vi.fn() },
    } as any;

    await ensureInitialFreeManagementGrant(tx, 'user-1', 'division-2');

    expect(create).not.toHaveBeenCalled();
    expect(tx.division.findFirst).not.toHaveBeenCalled();
  });

  it('detaches financial identity before functional account deletion', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn(),
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: 'billing-1' }),
        update: vi.fn(),
      },
      freeManagementGrant: { updateMany: vi.fn() },
      billingProviderIdentity: { updateMany: vi.fn() },
    } as any;

    await detachBillingAccount(tx, 'user-1');
    expect(tx.freeManagementGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { endedAt: expect.any(Date), endReason: 'ACCOUNT_DELETED' },
    }));
    expect(tx.billingProviderIdentity.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'RETIRED', retiredAt: expect.any(Date) },
    }));
    expect(tx.billingAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: null, detachReason: 'ACCOUNT_DELETED' }),
    }));
  });

  it.each([
    ['CAPITAN', 'CAPITAN', 10, 0],
    ['LIGA', 'FREE_LIGA', 40, 1],
    ['ADMINISTRADOR', 'ADMIN', null, null],
  ] as const)('resolves %s independently from paid state', async (role, accessKind, teamLimit, leagueLimit) => {
    const client = {
      user: { findUnique: vi.fn().mockResolvedValue({ rol: role }) },
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'billing-1',
          freeGrants: [{
            divisionIdSnapshot: 'division-1',
            divisionNameSnapshot: 'Primera',
            leagueIdSnapshot: 'league-1',
            leagueNameSnapshot: 'Liga',
            grantedAt: new Date('2026-09-10T12:00:00.000Z'),
          }],
        }),
      },
    } as any;

    await expect(resolveAccountAccessPolicy('user-1', client)).resolves.toMatchObject({
      role,
      accessKind,
      ownedTeamLimit: teamLimit,
      ownedLeagueLimit: leagueLimit,
    });
  });

  it('does not revive an expired migration when a pause starts after its deadline', async () => {
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    const now = new Date('2026-09-30T12:00:00Z');
    const client = {
      user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
      billingAccount: { findUnique: vi.fn().mockResolvedValue({
        id: 'billing-1', freeGrants: [],
        migrationAccess: {
          status: 'SELECTION_REQUIRED', deadline: new Date('2026-09-30T10:00:00Z'),
          preparedDivisionCount: 2, selectedFreeDivisionIdSnapshot: null, divisions: [],
        },
      }) },
      $queryRaw: vi.fn().mockResolvedValue([{ now }]),
      billingOperationalPause: {
        findFirst: vi.fn().mockResolvedValue({ startedAt: new Date('2026-09-30T11:00:00Z') }),
      },
    } as any;

    const policy = await resolveAccountAccessPolicy('user-1', client);
    expect(policy).toMatchObject({ effectiveAccess: 'FREE' });
    expect(policy).not.toHaveProperty('migrationOverlayActive');
  });
});
