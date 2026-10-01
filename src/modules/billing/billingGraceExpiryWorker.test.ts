import { describe, expect, it, vi } from 'vitest';
import { processBillingGraceExpirations } from './billingGraceExpiryWorker';

describe('billing local grace expiry worker', () => {
  it('returns the exact next durable deadline when nothing is due', async () => {
    const nextDueAt = new Date('2026-10-10T12:00:00Z');
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ endsAt: nextDueAt });
    const client = { billingLocalGrace: { findFirst } };

    await expect(processBillingGraceExpirations(client as never)).resolves.toEqual({
      processedCount: 0,
      nextDueAt,
    });
  });

  it('expires a due incident under the account lock and creates one free grant', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: 'grace-1', billingAccountId: 'billing-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ now }]),
      billingLocalGrace: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'grace-1',
          status: 'ACTIVE',
          startedAt: new Date('2026-10-01T12:00:00Z'),
          endsAt: new Date('2026-10-09T12:00:00Z'),
          billingAccountId: 'billing-1',
          sourceBillingPeriodId: 'period-1',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'user-1' }),
      },
      divisionCapacityAssignment: {
        findMany: vi.fn().mockResolvedValue([{
          divisionId: 'division-1',
          divisionIdSnapshot: 'division-1',
          divisionNameSnapshot: 'Division 1',
          leagueIdSnapshot: 'league-1',
          leagueNameSnapshot: 'League 1',
        }]),
      },
      freeManagementGrant: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'grant-1' }),
      },
      division: {
        findFirst: vi.fn().mockResolvedValue({ id: 'division-1', ligaId: 'league-1' }),
      },
      billingAuditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const client = {
      billingLocalGrace: { findFirst },
      $transaction: vi.fn((callback) => callback(tx)),
    };

    await expect(processBillingGraceExpirations(client as never)).resolves.toEqual({
      processedCount: 1,
      nextDueAt: null,
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'billing-account:billing-1',
    );
    expect(tx.freeManagementGrant.create).toHaveBeenCalledOnce();
    expect(tx.billingLocalGrace.updateMany).toHaveBeenCalledOnce();
  });
});
