import { describe, expect, it, vi } from 'vitest';
import { resolvePaidAccessShadow } from './paidAccessShadow';

const NOW = new Date('2026-09-24T12:00:00Z');

function period(overrides: Record<string, unknown> = {}) {
  return {
    source: 'STORE',
    capacityAtStart: 2,
    enforcedAt: new Date('2026-09-24T11:00:00Z'),
    primaryProviderPeriodId: 'provider-period-1',
    providerSources: [{ billingProviderPeriodId: 'provider-period-1', isPrimary: true }],
    capacityGrants: [],
    assignments: [{
      slotNumber: 1,
      divisionId: 'division-1',
      divisionIdSnapshot: 'division-1',
      ownerUserIdSnapshot: 'user-1',
      assignedAt: new Date('2026-09-24T11:00:00Z'),
    }],
    ...overrides,
  };
}

function client(periods: unknown[], userId: string | null = 'user-1', graces: unknown[] = []) {
  const tx = {
    billingAccount: { findUnique: vi.fn().mockResolvedValue(userId === null ? { userId: null } : { userId }) },
    $queryRaw: vi.fn().mockResolvedValue([{ now: NOW }]),
    billingPeriod: { findMany: vi.fn().mockResolvedValue(periods) },
    billingLocalGrace: { findMany: vi.fn().mockResolvedValue(graces) },
  };
  return {
    tx,
    client: { $transaction: vi.fn((callback) => callback(tx)) },
  };
}

describe('paid access shadow resolver', () => {
  it('derives paid capacity and keeps tombstoned assignments', async () => {
    const fixture = client([period({
      capacityGrants: [{
        id: 'grant-1',
        effectiveAt: new Date('2026-09-24T11:30:00Z'),
        sequence: 1,
        newCapacity: 3,
      }],
      assignments: [
        period().assignments[0],
        { ...period().assignments[0], slotNumber: 2, divisionId: null, divisionIdSnapshot: 'division-2' },
      ],
    })]);

    await expect(resolvePaidAccessShadow('billing-1', fixture.client as never)).resolves.toEqual({
      state: 'PAID',
      capacity: 3,
      assignments: [
        expect.objectContaining({ slotNumber: 1, divisionId: 'division-1' }),
        expect.objectContaining({ slotNumber: 2, divisionId: null, divisionIdSnapshot: 'division-2' }),
      ],
    });
  });

  it('returns none for detached accounts and missing current periods', async () => {
    await expect(resolvePaidAccessShadow('billing-1', client([], null).client as never))
      .resolves.toEqual({ state: 'NONE', reason: 'DETACHED_ACCOUNT' });
    await expect(resolvePaidAccessShadow('billing-1', client([]).client as never))
      .resolves.toEqual({ state: 'NONE', reason: 'NO_CURRENT_PERIOD' });
  });

  it('blocks ambiguous, unenforced and malformed period evidence', async () => {
    await expect(resolvePaidAccessShadow('billing-1', client([period(), period()]).client as never))
      .resolves.toEqual({ state: 'BLOCKED', reason: 'multiple_current_periods' });
    await expect(resolvePaidAccessShadow('billing-1', client([period({ enforcedAt: null })]).client as never))
      .resolves.toEqual({ state: 'BLOCKED', reason: 'unenforced_period' });
    await expect(resolvePaidAccessShadow('billing-1', client([period({
      assignments: [{ ...period().assignments[0], slotNumber: 3 }],
    })]).client as never)).resolves.toEqual({ state: 'BLOCKED', reason: 'assignment_out_of_capacity' });
  });

  it('blocks assignments owned by another account user', async () => {
    const fixture = client([period({
      assignments: [{ ...period().assignments[0], ownerUserIdSnapshot: 'user-2' }],
    })]);
    await expect(resolvePaidAccessShadow('billing-1', fixture.client as never))
      .resolves.toEqual({ state: 'BLOCKED', reason: 'assignment_owner_mismatch' });
  });

  it('resolves an active grace from its immutable source assignments', async () => {
    const fixture = client([], 'user-1', [{
      startedAt: new Date('2026-09-24T11:30:00Z'),
      endsAt: new Date('2026-10-01T12:00:00Z'),
      sourceBillingPeriod: {
        billingAccountId: 'billing-1',
        ...period(),
      },
    }]);
    await expect(resolvePaidAccessShadow('billing-1', fixture.client as never)).resolves.toMatchObject({
      state: 'LOCAL_GRACE',
      capacity: 2,
      graceEndsAt: new Date('2026-10-01T12:00:00Z'),
      assignments: [expect.objectContaining({ divisionId: 'division-1', slotNumber: 1 })],
    });
  });
});
