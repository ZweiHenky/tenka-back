import { describe, expect, it, vi } from 'vitest';
import { acquireAccountQuotaLock, assertAccountQuotaDelta, getAccountQuota } from './accountQuota';

function quotaClient(role: 'CAPITAN' | 'LIGA' | 'ADMINISTRADOR', usage: [number, number, number, number]) {
  const divisionCount = vi.fn()
    .mockResolvedValueOnce(usage[2])
    .mockResolvedValueOnce(usage[3]);
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: role }) },
    billingAccount: {
      findUnique: vi.fn().mockResolvedValue(role === 'LIGA'
        ? { id: 'billing-1', freeGrants: [] }
        : null),
    },
    equipo: { count: vi.fn().mockResolvedValue(usage[0]) },
    liga: { count: vi.fn().mockResolvedValue(usage[1]) },
    division: { count: divisionCount },
    $executeRawUnsafe: vi.fn(),
  } as any;
}

describe('account free-tier quotas', () => {
  it.each([
    ['CAPITAN', { teams: 10, leagues: 0, divisions: 0, activeDivisions: 0 }],
    ['LIGA', { teams: 40, leagues: 1, divisions: 1, activeDivisions: 1 }],
    ['ADMINISTRADOR', { teams: null, leagues: null, divisions: null, activeDivisions: null }],
  ] as const)('returns persisted %s limits and ownership usage', async (role, limits) => {
    await expect(getAccountQuota('user-1', quotaClient(role, [3, 1, 2, 1]))).resolves.toEqual({
      role,
      limits,
      usage: { teams: 3, leagues: 1, divisions: 2, activeDivisions: 1 },
    });
  });

  it('uses the billing owner bootstrap lock before an account exists', async () => {
    const tx = quotaClient('CAPITAN', [0, 0, 0, 0]);
    await acquireAccountQuotaLock(tx, 'user-1');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'billing-owner:user-1',
    );
  });

  it('uses the stable billing account lock when an account exists', async () => {
    const tx = quotaClient('LIGA', [0, 0, 0, 0]);
    await acquireAccountQuotaLock(tx, 'user-1');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'billing-account:billing-1',
    );
  });

  it('hands off from the bootstrap lock to an account created while waiting', async () => {
    const tx = quotaClient('CAPITAN', [0, 0, 0, 0]);
    tx.billingAccount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'billing-created' });

    await acquireAccountQuotaLock(tx, 'user-1');

    expect(tx.$executeRawUnsafe.mock.calls).toEqual([
      ['SELECT pg_advisory_xact_lock(hashtext($1))', 'billing-owner:user-1'],
      ['SELECT pg_advisory_xact_lock(hashtext($1))', 'billing-account:billing-created'],
    ]);
  });

  it('returns a stable 422 error for a positive delta at the limit', async () => {
    await expect(assertAccountQuotaDelta(quotaClient('CAPITAN', [10, 0, 0, 0]), 'user-1', { teams: 1 }))
      .rejects.toMatchObject({
        statusCode: 422,
        code: 'QUOTA_TEAMS_EXCEEDED',
        details: { resource: 'teams', limit: 10, usage: 10, delta: 1 },
      });
  });

  it('grandfathers existing excess for zero/decreasing deltas but blocks further growth', async () => {
    await expect(assertAccountQuotaDelta(quotaClient('LIGA', [41, 2, 3, 2]), 'user-1', {
      teams: 0, leagues: -1, divisions: 0, activeDivisions: 0,
    })).resolves.toBeDefined();
    await expect(assertAccountQuotaDelta(quotaClient('LIGA', [41, 2, 3, 2]), 'user-1', { divisions: 1 }))
      .rejects.toMatchObject({ code: 'QUOTA_DIVISIONS_EXCEEDED' });
  });

  it('allows an owner with zero active divisions to activate one despite excess total divisions', async () => {
    await expect(assertAccountQuotaDelta(quotaClient('LIGA', [0, 1, 4, 0]), 'user-1', { activeDivisions: 1 }))
      .resolves.toBeDefined();
  });
});
