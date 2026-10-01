import { afterEach, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { ensureBillingAccount } from './service';

const PREFIX = 'it-billing-migration';
const USER_ID = `${PREFIX}-user`;
const LEAGUE_ID = `${PREFIX}-league`;
const DIVISION_IDS = [`${PREFIX}-division-a`, `${PREFIX}-division-b`];

async function cleanup() {
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.division.deleteMany({ where: { id: { in: DIVISION_IDS } } });
  await prisma.liga.deleteMany({ where: { id: LEAGUE_ID } });
  await prisma.ubicacion.deleteMany({ where: { id: `${PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

afterEach(cleanup);

async function setup() {
  await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' } });
  const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, USER_ID));
  await prisma.ubicacion.create({
    data: { id: `${PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${PREFIX}-category`, nombre: 'Migration Test' } }),
    prisma.tipo.create({ data: { id: `${PREFIX}-type`, nombre: 'Migration Test' } }),
    prisma.estadoLiga.create({ data: { id: `${PREFIX}-status`, nombre: 'Migration Test', codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: `${PREFIX}-competition`, nombre: 'Migration Test', codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
  await prisma.liga.create({
    data: {
      id: LEAGUE_ID,
      nombre: 'Migration league',
      nombreNormalizado: PREFIX,
      descripcion: 'Test',
      userId: USER_ID,
      ubicacionId: `${PREFIX}-location`,
    },
  });
  for (const [index, id] of DIVISION_IDS.entries()) {
    await prisma.division.create({
      data: {
        id,
        nombre: `Migration division ${index + 1}`,
        maxEquipos: 8,
        createdAt: new Date(`2026-01-0${index + 1}T00:00:00Z`),
        ligaId: LEAGUE_ID,
        categoriaId: `${PREFIX}-category`,
        tipoId: `${PREFIX}-type`,
        estadoLigaId: `${PREFIX}-status`,
        tipoCompetenciaId: `${PREFIX}-competition`,
      },
    });
  }
  return account;
}

async function createPreparedMigration(accountId: string) {
  const divisions = await prisma.division.findMany({
    where: { id: { in: DIVISION_IDS } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return prisma.$transaction((tx) => tx.billingMigrationAccess.create({
    data: {
      id: `${PREFIX}-access`,
      billingAccountId: accountId,
      status: 'PREPARED',
      preparedAt: new Date('2026-09-25T12:00:00Z'),
      preparedDivisionCount: divisions.length,
      divisions: {
        create: divisions.map((division, index) => ({
          id: `${PREFIX}-snapshot-${index + 1}`,
          divisionId: division.id,
          divisionIdSnapshot: division.id,
          divisionCreatedAtSnapshot: division.createdAt,
          leagueIdSnapshot: division.ligaId,
        })),
      },
    },
    include: { divisions: true },
  }));
}

describe('billing migration preparation constraints', () => {
  test('persists only a complete PREPARED inventory with no active lifecycle dates', async () => {
    const account = await setup();
    const migration = await createPreparedMigration(account.id);

    expect(migration).toMatchObject({
      status: 'PREPARED',
      preparedDivisionCount: 2,
      startedAt: null,
      deadline: null,
      activatedAt: null,
      appliedAt: null,
      selectedFreeDivisionIdSnapshot: null,
    });
    expect(migration.divisions).toHaveLength(2);
  });

  test('rejects a parent whose deferred snapshot count is incomplete', async () => {
    const account = await setup();

    await expect(prisma.billingMigrationAccess.create({
      data: {
        id: `${PREFIX}-access`,
        billingAccountId: account.id,
        preparedAt: new Date('2026-09-25T12:00:00Z'),
        preparedDivisionCount: 2,
      },
    })).rejects.toThrow();
    expect(await prisma.billingMigrationAccess.count({ where: { billingAccountId: account.id } })).toBe(0);
  });

  test('rejects snapshot values that do not match the live division', async () => {
    const account = await setup();
    const division = await prisma.division.findUniqueOrThrow({ where: { id: DIVISION_IDS[0] } });

    await expect(prisma.billingMigrationAccess.create({
      data: {
        id: `${PREFIX}-access`,
        billingAccountId: account.id,
        preparedAt: new Date('2026-09-25T12:00:00Z'),
        preparedDivisionCount: 2,
        divisions: { create: [
          {
            id: `${PREFIX}-snapshot-1`, divisionId: division.id,
            divisionIdSnapshot: division.id, divisionCreatedAtSnapshot: division.createdAt,
            leagueIdSnapshot: 'wrong-league',
          },
          {
            id: `${PREFIX}-snapshot-2`, divisionId: DIVISION_IDS[1],
            divisionIdSnapshot: DIVISION_IDS[1], divisionCreatedAtSnapshot: new Date('2026-01-02T00:00:00Z'),
            leagueIdSnapshot: LEAGUE_ID,
          },
        ] },
      },
    })).rejects.toThrow();
  });

  test('allows only the live division tombstone while preserving immutable snapshots', async () => {
    const account = await setup();
    await createPreparedMigration(account.id);

    await prisma.division.delete({ where: { id: DIVISION_IDS[0] } });
    const snapshot = await prisma.billingMigrationDivision.findUniqueOrThrow({
      where: { id: `${PREFIX}-snapshot-1` },
    });
    expect(snapshot).toMatchObject({ divisionId: null, divisionIdSnapshot: DIVISION_IDS[0], leagueIdSnapshot: LEAGUE_ID });
    await expect(prisma.billingMigrationDivision.update({
      where: { id: snapshot.id },
      data: { leagueIdSnapshot: 'rewritten' },
    })).rejects.toThrow();
  });
});
