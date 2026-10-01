import { afterAll, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { reconcileFreeFoundationUserInTransaction } from './freeFoundationReconciliation';

const PREFIX = 'it-free-foundation';
const ZERO_USER_ID = `${PREFIX}-zero-user`;
const ONE_USER_ID = `${PREFIX}-one-user`;
const LEAGUE_ID = `${PREFIX}-league`;
const DIVISION_ID = `${PREFIX}-division`;

async function cleanup() {
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.division.deleteMany({ where: { id: DIVISION_ID } });
  await prisma.liga.deleteMany({ where: { id: LEAGUE_ID } });
  await prisma.ubicacion.deleteMany({ where: { id: `${PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: { in: [ZERO_USER_ID, ONE_USER_ID] } } });
}

afterAll(cleanup);

async function setup() {
  await prisma.user.createMany({ data: [
    { id: ZERO_USER_ID, email: `${ZERO_USER_ID}@example.test`, rol: 'LIGA' },
    { id: ONE_USER_ID, email: `${ONE_USER_ID}@example.test`, rol: 'LIGA' },
  ] });
  await prisma.ubicacion.create({
    data: { id: `${PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${PREFIX}-category`, nombre: 'Free Foundation Test' } }),
    prisma.tipo.create({ data: { id: `${PREFIX}-type`, nombre: 'Free Foundation Test' } }),
    prisma.estadoLiga.create({ data: { id: `${PREFIX}-status`, nombre: 'Free Foundation Test', codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: `${PREFIX}-competition`, nombre: 'Free Foundation Test', codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
  await prisma.liga.create({
    data: {
      id: LEAGUE_ID, nombre: 'Free Foundation League', nombreNormalizado: PREFIX,
      descripcion: 'Test', userId: ONE_USER_ID, ubicacionId: `${PREFIX}-location`,
    },
  });
  await prisma.division.create({
    data: {
      id: DIVISION_ID, nombre: 'Free Foundation Division', maxEquipos: 8,
      ligaId: LEAGUE_ID, categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`,
      estadoLigaId: `${PREFIX}-status`, tipoCompetenciaId: `${PREFIX}-competition`,
    },
  });
}

describe('billing free foundation reconciliation', () => {
  test('creates missing accounts and only the eligible grant exactly once', async () => {
    await setup();
    for (let run = 0; run < 2; run += 1) {
      for (const userId of [ZERO_USER_ID, ONE_USER_ID]) {
        await prisma.$transaction(
          (tx) => reconcileFreeFoundationUserInTransaction(tx, userId),
          { isolationLevel: 'Serializable' },
        );
      }
    }

    const accounts = await prisma.billingAccount.findMany({
      where: { userId: { in: [ZERO_USER_ID, ONE_USER_ID] } },
      include: { providerIdentities: true, freeGrants: true },
    });
    expect(accounts).toHaveLength(2);
    expect(accounts.every((account) => account.providerIdentities.length === 1
      && account.providerIdentities[0].kind === 'CANONICAL'
      && account.providerIdentities[0].revenueCatAppUserId === account.id)).toBe(true);
    expect(accounts.find(({ userId }) => userId === ZERO_USER_ID)?.freeGrants).toHaveLength(0);
    expect(accounts.find(({ userId }) => userId === ONE_USER_ID)?.freeGrants).toMatchObject([{
      divisionId: DIVISION_ID,
      divisionIdSnapshot: DIVISION_ID,
      source: 'INITIAL_FREE',
    }]);
    expect(await prisma.billingAuditLog.count({
      where: {
        action: 'BILLING_FREE_FOUNDATION_RECONCILED',
        targetId: { in: accounts.map(({ id }) => id) },
      },
    })).toBe(2);
  }, 30_000);
});
