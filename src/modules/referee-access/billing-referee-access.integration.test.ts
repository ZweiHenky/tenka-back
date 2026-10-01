import { afterEach, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { ensureInitialFreeManagementGrant } from '../billing/service';
import { refereeAccessService } from './service';

const PREFIX = 'it-billing-referee';
const ids = {
  user: `${PREFIX}-user`, location: `${PREFIX}-location`, league: `${PREFIX}-league`,
  category: `${PREFIX}-category`, type: `${PREFIX}-type`, state: `${PREFIX}-state`,
  competition: `${PREFIX}-competition`,
  freeDivision: `${PREFIX}-division-free`, readOnlyDivision: `${PREFIX}-division-read-only`,
  freeJornada: `${PREFIX}-jornada-free`, readOnlyJornada: `${PREFIX}-jornada-read-only`,
  freeMatch: `${PREFIX}-match-free`, readOnlyMatch: `${PREFIX}-match-read-only`,
} as const;

async function cleanup() {
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.liga.deleteMany({ where: { id: ids.league } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.ubicacion.deleteMany({ where: { id: ids.location } });
  await prisma.categoria.deleteMany({ where: { id: ids.category } });
  await prisma.tipo.deleteMany({ where: { id: ids.type } });
  await prisma.estadoLiga.deleteMany({ where: { id: ids.state } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: ids.competition } });
}

afterEach(cleanup);

async function setup() {
  await prisma.user.create({ data: { id: ids.user, email: `${ids.user}@example.test`, rol: 'LIGA' } });
  await prisma.ubicacion.create({
    data: { id: ids.location, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: ids.category, nombre: PREFIX } }),
    prisma.tipo.create({ data: { id: ids.type, nombre: PREFIX } }),
    prisma.estadoLiga.create({ data: { id: ids.state, nombre: 'En curso', codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: ids.competition, nombre: PREFIX, codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
  await prisma.liga.create({
    data: {
      id: ids.league, nombre: 'Liga referee billing', nombreNormalizado: PREFIX,
      descripcion: 'Test', userId: ids.user, ubicacionId: ids.location,
    },
  });
  const divisionData = {
    maxEquipos: 2, ligaId: ids.league, categoriaId: ids.category, tipoId: ids.type,
    estadoLigaId: ids.state, tipoCompetenciaId: ids.competition,
  };
  await prisma.division.create({ data: { id: ids.freeDivision, nombre: 'Free division', ...divisionData } });
  await prisma.$transaction((tx) => ensureInitialFreeManagementGrant(tx, ids.user, ids.freeDivision));
  await prisma.division.create({ data: { id: ids.readOnlyDivision, nombre: 'Read-only division', ...divisionData } });
  await prisma.jornada.createMany({ data: [
    { id: ids.freeJornada, numero: 1, divisionId: ids.freeDivision },
    { id: ids.readOnlyJornada, numero: 1, divisionId: ids.readOnlyDivision },
  ] });
  await prisma.partido.createMany({ data: [
    { id: ids.freeMatch, jornadaId: ids.freeJornada, estado: 'PROGRAMADO', tipoPartido: 'AMISTOSO' },
    { id: ids.readOnlyMatch, jornadaId: ids.readOnlyJornada, estado: 'PROGRAMADO', tipoPartido: 'AMISTOSO' },
  ] });
  const actor = { id: ids.user, email: `${ids.user}@example.test`, rol: 'LIGA' as const };
  return {
    freeLink: await refereeAccessService.createAccess(ids.freeMatch, actor),
    readOnlyLink: await refereeAccessService.createAccess(ids.readOnlyMatch, actor),
  };
}

describe('referee token billing enforcement', () => {
  test('consumes an allowed token and rolls back a read-only token result', async () => {
    const { freeLink, readOnlyLink } = await setup();
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(refereeAccessService.updateResultByToken(`Bearer ${freeLink.token}`, {
        expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      })).resolves.toMatchObject({ id: ids.freeMatch, estado: 'FINALIZADO', version: 1 });
      await expect(prisma.partidoRefereeAccess.findFirstOrThrow({ where: { partidoId: ids.freeMatch } }))
        .resolves.toMatchObject({ usedAt: expect.any(Date) });

      await expect(refereeAccessService.updateResultByToken(`Bearer ${readOnlyLink.token}`, {
        expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      })).rejects.toMatchObject({ code: 'BILLING_RESOURCE_READ_ONLY' });
      await expect(prisma.partido.findUniqueOrThrow({ where: { id: ids.readOnlyMatch } }))
        .resolves.toMatchObject({ estado: 'PROGRAMADO', version: 0, golesLocal: 0, golesVisitante: 0 });
      await expect(prisma.partidoRefereeAccess.findFirstOrThrow({ where: { partidoId: ids.readOnlyMatch } }))
        .resolves.toMatchObject({ usedAt: null });
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 45_000);
});
