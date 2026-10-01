import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';

export type LegacyMigrationFixtureErrorCode =
  | 'ACCOUNT_NOT_FOUND_OR_DETACHED'
  | 'ROLE_REQUIRED'
  | 'CANONICAL_IDENTITY_INVALID'
  | 'ACTIVE_FREE_GRANT_EXISTS'
  | 'HISTORICAL_FREE_GRANT_EXISTS'
  | 'STORE_HISTORY_EXISTS'
  | 'MIGRATION_EXISTS'
  | 'FUNCTIONAL_DATA_EXISTS'
  | 'REQUIRED_CATALOG_MISSING';

export class LegacyMigrationFixtureError extends Error {
  constructor(readonly code: LegacyMigrationFixtureErrorCode, message: string) {
    super(message);
  }
}

function fixtureIds(billingAccountId: string) {
  const suffix = createHash('sha256').update(billingAccountId).digest('hex').slice(0, 20);
  return {
    locationId: `billing_migration_fixture_location_${suffix}`,
    leagueId: `billing_migration_fixture_league_${suffix}`,
    divisionIds: [
      `billing_migration_fixture_division_a_${suffix}`,
      `billing_migration_fixture_division_b_${suffix}`,
    ],
    normalizedLeagueName: `billing migration fixture ${suffix}`,
  };
}

export async function createLegacyBillingMigrationCandidateFixture(
  billingAccountId: string,
  client: PrismaClient,
): Promise<{ created: boolean; divisionCount: 2 }> {
  assertDevelopmentScriptContext();
  if (!/^billing_[A-Za-z0-9_-]{8,100}$/.test(billingAccountId)) {
    throw new Error('A canonical billing account ID is required');
  }
  const ids = fixtureIds(billingAccountId);

  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `billing-account:${billingAccountId}`);
    await tx.$queryRaw`SELECT "id" FROM billing_accounts WHERE "id" = ${billingAccountId} FOR UPDATE`;
    const account = await tx.billingAccount.findUnique({
      where: { id: billingAccountId },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            rol: true,
            ligas: { select: { id: true, divisiones: { select: { id: true } } } },
          },
        },
        providerIdentities: { select: { kind: true, status: true, revenueCatAppUserId: true } },
        freeGrants: { select: { id: true, endedAt: true } },
        billingPeriods: { where: { source: 'STORE' }, select: { id: true } },
        migrationAccess: { select: { id: true } },
      },
    });
    if (!account?.userId || !account.user) {
      throw new LegacyMigrationFixtureError('ACCOUNT_NOT_FOUND_OR_DETACHED', 'The billing account must be attached to a user');
    }
    if (account.user.rol !== 'LIGA') {
      throw new LegacyMigrationFixtureError('ROLE_REQUIRED', 'The billing account owner must have role LIGA');
    }
    const canonical = account.providerIdentities.filter(({ kind }) => kind === 'CANONICAL');
    if (canonical.length !== 1 || canonical[0].status !== 'ACTIVE'
      || canonical[0].revenueCatAppUserId !== account.id) {
      throw new LegacyMigrationFixtureError(
        'CANONICAL_IDENTITY_INVALID', 'The billing account must have one active canonical provider identity',
      );
    }
    if (account.freeGrants.some(({ endedAt }) => !endedAt)) {
      throw new LegacyMigrationFixtureError('ACTIVE_FREE_GRANT_EXISTS', 'The billing account has an active free grant');
    }
    if (account.freeGrants.length > 0) {
      throw new LegacyMigrationFixtureError('HISTORICAL_FREE_GRANT_EXISTS', 'The billing account has free grant history');
    }
    if (account.billingPeriods.length > 0) {
      throw new LegacyMigrationFixtureError('STORE_HISTORY_EXISTS', 'The billing account has STORE history');
    }
    if (account.migrationAccess) {
      throw new LegacyMigrationFixtureError('MIGRATION_EXISTS', 'The billing account already has a migration');
    }

    const leagues = account.user.ligas;
    const exactFixture = leagues.length === 1 && leagues[0].id === ids.leagueId
      && leagues[0].divisiones.length === 2
      && ids.divisionIds.every((id) => leagues[0].divisiones.some((division) => division.id === id));
    if (exactFixture) return { created: false, divisionCount: 2 };
    if (leagues.length > 0) {
      throw new LegacyMigrationFixtureError('FUNCTIONAL_DATA_EXISTS', 'The fixture requires an owner with no existing leagues');
    }

    const [category, type, state, competition] = await Promise.all([
      tx.categoria.findFirst({ where: { nombre: 'LIBRE' }, select: { id: true } }),
      tx.tipo.findFirst({ where: { nombre: 'FUTBOL 7' }, select: { id: true } }),
      tx.estadoLiga.findFirst({ where: { codigo: 'BORRADOR' }, select: { id: true } }),
      tx.tipoCompetencia.findFirst({ where: { codigo: 'LIGA_Y_ELIMINATORIAS' }, select: { id: true } }),
    ]);
    if (!category || !type || !state || !competition) {
      throw new LegacyMigrationFixtureError('REQUIRED_CATALOG_MISSING', 'Required development catalogs are missing');
    }

    await tx.ubicacion.create({
      data: {
        id: ids.locationId,
        lat: 19.4326,
        lng: -99.1332,
        nombreCompleto: 'Fixture migratorio, Ciudad de Mexico',
        estado: 'Ciudad de Mexico',
        municipio: 'Cuauhtemoc',
        timeZone: 'America/Mexico_City',
      },
    });
    await tx.liga.create({
      data: {
        id: ids.leagueId,
        nombre: 'Liga fixture migratoria',
        nombreNormalizado: ids.normalizedLeagueName,
        descripcion: 'Fixture development-only para ensayar la migracion de cuentas legacy.',
        ubicacionId: ids.locationId,
        userId: account.userId,
        divisiones: {
          create: ids.divisionIds.map((id, index) => ({
            id,
            nombre: `Division legacy ${index + 1}`,
            maxEquipos: 8,
            estadoLigaId: state.id,
            categoriaId: category.id,
            tipoId: type.id,
            tipoCompetenciaId: competition.id,
          })),
        },
      },
    });
    return { created: true, divisionCount: 2 };
  }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
}
