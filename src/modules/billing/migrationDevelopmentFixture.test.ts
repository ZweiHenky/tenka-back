import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/developmentDatabase', () => ({ assertDevelopmentScriptContext: vi.fn() }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: vi.fn() }));

import type { PrismaClient } from '../../generated/prisma/client';
import { createLegacyBillingMigrationCandidateFixture } from './migrationDevelopmentFixture';

const ACCOUNT_ID = 'billing_fixture_account01';

function cleanAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    userId: 'user-1',
    user: { rol: 'LIGA', ligas: [] },
    providerIdentities: [{ kind: 'CANONICAL', status: 'ACTIVE', revenueCatAppUserId: ACCOUNT_ID }],
    freeGrants: [],
    billingPeriods: [],
    migrationAccess: null,
    ...overrides,
  };
}

function fixtureClient(account = cleanAccount()) {
  const locationCreate = vi.fn();
  const leagueCreate = vi.fn();
  const tx = {
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    billingAccount: { findUnique: vi.fn().mockResolvedValue(account) },
    categoria: { findFirst: vi.fn().mockResolvedValue({ id: 'category-1' }) },
    tipo: { findFirst: vi.fn().mockResolvedValue({ id: 'type-1' }) },
    estadoLiga: { findFirst: vi.fn().mockResolvedValue({ id: 'state-1' }) },
    tipoCompetencia: { findFirst: vi.fn().mockResolvedValue({ id: 'competition-1' }) },
    ubicacion: { create: locationCreate },
    liga: { create: leagueCreate },
  };
  return {
    client: { $transaction: vi.fn((callback) => callback(tx)) } as unknown as PrismaClient,
    tx,
    locationCreate,
    leagueCreate,
  };
}

describe('legacy billing migration candidate fixture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates exactly two legacy divisions for an explicit clean canonical account', async () => {
    const fixture = fixtureClient();
    await expect(createLegacyBillingMigrationCandidateFixture(ACCOUNT_ID, fixture.client))
      .resolves.toEqual({ created: true, divisionCount: 2 });

    expect(fixture.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `billing-account:${ACCOUNT_ID}`,
    );
    expect(fixture.locationCreate).toHaveBeenCalledOnce();
    const leagueData = fixture.leagueCreate.mock.calls[0][0].data;
    expect(leagueData).toMatchObject({ userId: 'user-1' });
    expect(leagueData.divisiones.create).toHaveLength(2);
    expect(leagueData.divisiones.create).toEqual([
      expect.objectContaining({ nombre: 'Division legacy 1' }),
      expect.objectContaining({ nombre: 'Division legacy 2' }),
    ]);
  });

  it('is idempotent only for the exact fixture shape', async () => {
    const initial = fixtureClient();
    await createLegacyBillingMigrationCandidateFixture(ACCOUNT_ID, initial.client);
    const data = initial.leagueCreate.mock.calls[0][0].data;
    const repeated = fixtureClient(cleanAccount({
      user: {
        rol: 'LIGA',
        ligas: [{
          id: data.id,
          divisiones: data.divisiones.create.map(({ id }: { id: string }) => ({ id })),
        }],
      },
    }));

    await expect(createLegacyBillingMigrationCandidateFixture(ACCOUNT_ID, repeated.client))
      .resolves.toEqual({ created: false, divisionCount: 2 });
    expect(repeated.locationCreate).not.toHaveBeenCalled();
    expect(repeated.leagueCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['an active free grant', { freeGrants: [{ id: 'grant-1', endedAt: null }] }, 'active free grant'],
    ['free grant history', { freeGrants: [{ id: 'grant-1', endedAt: new Date() }] }, 'free grant history'],
    ['store history', { billingPeriods: [{ id: 'period-1' }] }, 'STORE history'],
    ['a migration', { migrationAccess: { id: 'migration-1' } }, 'already has a migration'],
  ])('rejects an account with %s without writing', async (_label, overrides, message) => {
    const fixture = fixtureClient(cleanAccount(overrides));
    await expect(createLegacyBillingMigrationCandidateFixture(ACCOUNT_ID, fixture.client))
      .rejects.toThrow(message);
    expect(fixture.locationCreate).not.toHaveBeenCalled();
    expect(fixture.leagueCreate).not.toHaveBeenCalled();
  });

  it('rejects existing functional leagues instead of modifying user data', async () => {
    const fixture = fixtureClient(cleanAccount({
      user: { rol: 'LIGA', ligas: [{ id: 'existing-league', divisiones: [] }] },
    }));
    await expect(createLegacyBillingMigrationCandidateFixture(ACCOUNT_ID, fixture.client))
      .rejects.toThrow('no existing leagues');
    expect(fixture.locationCreate).not.toHaveBeenCalled();
  });
});
