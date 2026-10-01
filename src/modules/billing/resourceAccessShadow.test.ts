import { describe, expect, it, vi } from 'vitest';
import {
  resolveDivisionAccessShadowInTransaction,
  resolveLeagueAccessShadowInTransaction,
} from './resourceAccessShadow';

const NOW = new Date('2026-09-24T12:00:00Z');

function txFixture(input: {
  divisionIds?: string[];
  freeDivisionId?: string | null;
  paid?: boolean;
  localGrace?: boolean;
  paidAssignmentIds?: Array<string | null>;
  ownerRole?: 'LIGA' | 'CAPITAN';
  migrationDivisionIds?: Array<string | null>;
  migrationActive?: boolean;
}) {
  const divisionIds = input.divisionIds ?? ['division-1'];
  const account = {
    id: 'billing-1',
    userId: 'owner-1',
    freeGrants: input.freeDivisionId ? [{ divisionId: input.freeDivisionId }] : [],
    migrationAccess: input.migrationDivisionIds ? {
      status: input.migrationActive ? 'PURCHASED' : 'PREPARED',
      deadline: input.migrationActive ? new Date('2026-10-24T12:00:00Z') : null,
      divisions: input.migrationDivisionIds.map((divisionId) => ({ divisionId })),
    } : null,
  };
  return {
    division: {
      findUnique: vi.fn().mockImplementation(({ where }) => divisionIds.includes(where.id)
        ? { id: where.id, liga: { userId: 'owner-1' } }
        : null),
    },
    liga: {
      findUnique: vi.fn().mockResolvedValue({
        userId: 'owner-1',
        divisiones: divisionIds.map((id) => ({ id })),
      }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ rol: input.ownerRole ?? 'LIGA' }) },
    billingAccount: {
      findUnique: vi.fn().mockResolvedValue(account),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ now: NOW }]),
    billingPeriod: {
      findMany: vi.fn().mockResolvedValue(input.paid ? [{
        source: 'STORE',
        capacityAtStart: 2,
        enforcedAt: new Date('2026-09-24T11:00:00Z'),
        primaryProviderPeriodId: 'provider-period-1',
        providerSources: [{ billingProviderPeriodId: 'provider-period-1', isPrimary: true }],
        capacityGrants: [],
        assignments: (input.paidAssignmentIds ?? []).map((divisionId, index) => ({
          slotNumber: index + 1,
          divisionId,
          divisionIdSnapshot: divisionId ?? `deleted-${index}`,
          ownerUserIdSnapshot: 'owner-1',
          assignedAt: new Date('2026-09-24T11:00:00Z'),
        })),
      }] : []),
    },
    billingLocalGrace: { findMany: vi.fn().mockResolvedValue(input.localGrace ? [{
      startedAt: new Date('2026-09-24T11:30:00Z'),
      endsAt: new Date('2026-10-01T12:00:00Z'),
      sourceBillingPeriod: {
        billingAccountId: 'billing-1',
        source: 'STORE',
        capacityAtStart: 2,
        enforcedAt: new Date('2026-09-20T12:00:00Z'),
        capacityGrants: [],
        assignments: (input.paidAssignmentIds ?? []).map((divisionId, index) => ({
          slotNumber: index + 1,
          divisionId,
          divisionIdSnapshot: divisionId ?? `deleted-${index}`,
          ownerUserIdSnapshot: 'owner-1',
          assignedAt: new Date('2026-09-20T12:00:00Z'),
        })),
      },
    }] : []) },
    billingOperationalPause: { findFirst: vi.fn().mockResolvedValue(null) },
  } as never;
}

describe('resource access shadow', () => {
  it('grants full access only to the exact free division', async () => {
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ freeDivisionId: 'division-1' }),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'FULL', reason: 'FREE', basis: 'FREE' });

    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ divisionIds: ['division-1', 'division-2'], freeDivisionId: 'division-1' }),
      { divisionId: 'division-2', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'READ_ONLY', reason: 'EXPIRED', basis: 'FREE' });
  });

  it('grants paid access only to a live exact assignment', async () => {
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ paid: true, paidAssignmentIds: ['division-1'] }),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'FULL', reason: 'PAID_ASSIGNED', basis: 'PAID' });

    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ paid: true, paidAssignmentIds: [null] }),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'READ_ONLY', reason: 'UNASSIGNED', basis: 'PAID' });
  });

  it('keeps paid assignments canonical and overlays only captured unassigned divisions', async () => {
    const fixture = {
      divisionIds: ['division-1', 'division-2'], paid: true,
      paidAssignmentIds: ['division-1'], migrationDivisionIds: ['division-1', 'division-2'],
      migrationActive: true,
    };
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture(fixture),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'FULL', reason: 'PAID_ASSIGNED', basis: 'PAID' });
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture(fixture),
      { divisionId: 'division-2', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'FULL', reason: 'MIGRATION', basis: 'MIGRATION' });
  });

  it('blocks contradictory free and paid evidence', async () => {
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ freeDivisionId: 'division-1', paid: true, paidAssignmentIds: ['division-1'] }),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE' });
  });

  it('honors the administrator actor without granting rights to the owner', async () => {
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ ownerRole: 'CAPITAN' }),
      { divisionId: 'division-1', actor: { id: 'admin-1', rol: 'ADMINISTRADOR' } },
    )).resolves.toMatchObject({ access: 'FULL', reason: 'ADMIN', basis: 'ADMIN' });
  });

  it('locks shared resources when any affected division is read-only', async () => {
    await expect(resolveLeagueAccessShadowInTransaction(
      txFixture({ divisionIds: ['division-1', 'division-2'], paid: true, paidAssignmentIds: ['division-1'] }),
      { leagueId: 'league-1', actor: { id: 'owner-1', rol: 'LIGA' }, resourceType: 'SHARED_RESOURCE' },
    )).resolves.toMatchObject({ access: 'READ_ONLY', reason: 'SHARED_RESOURCE_LOCKED' });
  });

  it('returns limited setup for an empty league with available capacity', async () => {
    await expect(resolveLeagueAccessShadowInTransaction(
      txFixture({ divisionIds: [], paid: true, paidAssignmentIds: [] }),
      { leagueId: 'league-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'LIMITED_SETUP', basis: 'PAID' });
  });

  it('preserves exact assignments during grace without allowing empty setup', async () => {
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ localGrace: true, paidAssignmentIds: ['division-1'] }),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'FULL', reason: 'LOCAL_GRACE', basis: 'LOCAL_GRACE' });

    await expect(resolveLeagueAccessShadowInTransaction(
      txFixture({ divisionIds: [], localGrace: true, paidAssignmentIds: [] }),
      { leagueId: 'league-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'READ_ONLY', basis: 'LOCAL_GRACE' });
  });

  it('blocks an empty league for an ineligible owner role', async () => {
    await expect(resolveLeagueAccessShadowInTransaction(
      txFixture({ divisionIds: [], ownerRole: 'CAPITAN' }),
      { leagueId: 'league-1', actor: { id: 'owner-1', rol: 'CAPITAN' } },
    )).resolves.toMatchObject({ access: 'BLOCKED', reason: 'ROLE_REQUIRED' });
  });

  it('blocks contradictory paid and free evidence for an empty league', async () => {
    await expect(resolveLeagueAccessShadowInTransaction(
      txFixture({ divisionIds: [], freeDivisionId: 'deleted-division', paid: true }),
      { leagueId: 'league-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({ access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE' });
  });

  it('blocks unknown affected divisions instead of treating them as empty setup', async () => {
    await expect(resolveLeagueAccessShadowInTransaction(
      txFixture({ divisionIds: ['division-1'], freeDivisionId: 'division-1' }),
      {
        leagueId: 'league-1',
        actor: { id: 'owner-1', rol: 'LIGA' },
        resourceType: 'SHARED_RESOURCE',
        affectedDivisionIds: ['unknown-division'],
      },
    )).resolves.toMatchObject({ access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE' });
  });

  it('observes PREPARED membership without changing the legacy shadow decision', async () => {
    await expect(resolveDivisionAccessShadowInTransaction(
      txFixture({ divisionIds: ['division-1', 'division-2'], migrationDivisionIds: ['division-1', 'division-2'] }),
      { divisionId: 'division-1', actor: { id: 'owner-1', rol: 'LIGA' } },
    )).resolves.toMatchObject({
      access: 'READ_ONLY',
      reason: 'EXPIRED',
      basis: 'FREE',
      migrationPrepared: true,
      migrationResourceCaptured: true,
      migrationCapturedCount: 2,
    });
  });
});
