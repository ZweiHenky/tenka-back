import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  paid: vi.fn(),
}));
vi.mock('../../config/env', () => ({
  env: { BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED: true, LOG_LEVEL: 'silent', APP_ENV: 'test' },
}));
vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('./catalog', () => ({
  billingEnvironmentForApp: vi.fn(),
  getActiveBillingCatalog: vi.fn(),
}));
vi.mock('./paidAccessShadow', () => ({
  resolvePaidAccessShadowInTransaction: mocks.paid,
}));

import { resolveAccountAccessPolicy } from './service';

function client(freeGrants: unknown[] = []) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ rol: 'LIGA' }) },
    billingAccount: {
      findUnique: vi.fn().mockResolvedValue({ id: 'billing-1', freeGrants }),
    },
  } as never;
}

describe('authoritative account access policy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('projects paid capacity and slot eligibility from materialized access', async () => {
    mocks.paid.mockResolvedValue({
      state: 'PAID', capacity: 3,
      assignments: [{ slotNumber: 1 }, { slotNumber: 2 }],
    });
    await expect(resolveAccountAccessPolicy('user-1', client())).resolves.toMatchObject({
      accessKind: 'PAID', effectiveAccess: 'PAID', effectiveCapacity: 3,
      ownedLeagueLimit: 3, ownedDivisionLimit: 3, canConsumePaidSlot: true,
    });
  });

  it('preserves grace capacity without allowing a new slot', async () => {
    mocks.paid.mockResolvedValue({
      state: 'LOCAL_GRACE', capacity: 3,
      assignments: [{ slotNumber: 1 }],
    });
    await expect(resolveAccountAccessPolicy('user-1', client())).resolves.toMatchObject({
      effectiveAccess: 'LOCAL_GRACE', effectiveCapacity: 3,
      ownedLeagueLimit: 3, canConsumePaidSlot: false,
    });
  });

  it('fails closed on malformed paid evidence or simultaneous free access', async () => {
    mocks.paid.mockResolvedValueOnce({ state: 'BLOCKED', reason: 'multiple_current_periods' });
    await expect(resolveAccountAccessPolicy('user-1', client())).rejects.toMatchObject({
      code: 'BILLING_EVIDENCE_INVALID',
    });

    mocks.paid.mockResolvedValueOnce({ state: 'PAID', capacity: 2, assignments: [] });
    await expect(resolveAccountAccessPolicy('user-1', client([{
      divisionIdSnapshot: 'division-1', divisionNameSnapshot: 'Division',
      leagueIdSnapshot: 'league-1', leagueNameSnapshot: 'Liga', grantedAt: new Date(),
    }]))).rejects.toMatchObject({ code: 'BILLING_EVIDENCE_INVALID' });
  });
});
