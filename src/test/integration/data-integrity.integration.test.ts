import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import { divisionService } from '../../modules/division/service';
import { jornadaService } from '../../modules/jornada/service';
import { ligaService } from '../../modules/liga/service';
import { partidoService } from '../../modules/partido/service';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import type { AuthenticatedUser } from '../../types/auth';
import { getIntegrationPgConnectionString, INTEGRATION_SCHEMA } from './database';

const ids = {
  user: 'it-integrity-user',
  ubicacion: 'it-integrity-location',
  categoria: 'it-integrity-category',
  tipo: 'it-integrity-type',
  estado: 'it-integrity-state',
  competencia: 'it-integrity-competition',
  liga: 'it-integrity-league',
  division: 'it-integrity-division',
  jornada: 'it-integrity-matchday',
  ronda: 'it-integrity-round',
  partido1: 'it-integrity-match-1',
  partido2: 'it-integrity-match-2',
  player: 'it-integrity-player-1',
  teams: ['it-integrity-team-a', 'it-integrity-team-b', 'it-integrity-team-c', 'it-integrity-team-d'],
} as const;

const owner: AuthenticatedUser = {
  id: ids.user,
  email: 'it-integrity-owner@example.test',
  rol: 'LIGA',
};

const triggerNames = {
  reset: 'it_fail_reset_round_delete',
  resetFunction: 'it_fail_reset_round_delete_fn',
  standings: 'it_fail_standings_insert',
  standingsFunction: 'it_fail_standings_insert_fn',
} as const;

let observer: Pool;

function newPrismaClient(applicationName: string): PrismaClient {
  const connectionString = new URL(getIntegrationPgConnectionString());
  connectionString.searchParams.set('application_name', applicationName);
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: connectionString.href, max: 1 },
      { schema: INTEGRATION_SCHEMA },
    ),
  });
}

async function installFailureTrigger(
  trigger: string,
  functionName: string,
  table: 'rondas_playoff' | 'tablas_posicion',
  operation: 'DELETE' | 'INSERT',
): Promise<void> {
  if ((INTEGRATION_SCHEMA as string) === 'public') throw new Error('Integration DDL must never target public');
  await observer.query(`
    CREATE OR REPLACE FUNCTION "${INTEGRATION_SCHEMA}"."${functionName}"()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'intentional integration failure';
    END;
    $$;
    CREATE TRIGGER "${trigger}"
    BEFORE ${operation} ON "${INTEGRATION_SCHEMA}"."${table}"
    FOR EACH STATEMENT EXECUTE FUNCTION "${INTEGRATION_SCHEMA}"."${functionName}"();
  `);
}

async function dropFailureTriggers(): Promise<void> {
  if ((INTEGRATION_SCHEMA as string) === 'public') throw new Error('Integration DDL must never target public');
  await observer.query(`
    DROP TRIGGER IF EXISTS "${triggerNames.reset}" ON "${INTEGRATION_SCHEMA}"."rondas_playoff";
    DROP FUNCTION IF EXISTS "${INTEGRATION_SCHEMA}"."${triggerNames.resetFunction}"();
    DROP TRIGGER IF EXISTS "${triggerNames.standings}" ON "${INTEGRATION_SCHEMA}"."tablas_posicion";
    DROP FUNCTION IF EXISTS "${INTEGRATION_SCHEMA}"."${triggerNames.standingsFunction}"();
  `);
}

async function seedFixture(): Promise<void> {
  await prisma.user.create({
    data: { id: ids.user, email: owner.email, name: 'Integration Owner', rol: 'LIGA' },
  });
  await prisma.ubicacion.create({
    data: { id: ids.ubicacion, lat: 19.4326, lng: -99.1332, nombreCompleto: 'Integration Venue', estado: 'Test', municipio: 'Test', timeZone: 'America/Mexico_City' },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: ids.categoria, nombre: 'Integration Category' } }),
    prisma.tipo.create({ data: { id: ids.tipo, nombre: 'Integration Type' } }),
    prisma.estadoLiga.create({ data: { id: ids.estado, nombre: 'En Curso' } }),
    prisma.tipoCompetencia.create({ data: { id: ids.competencia, nombre: 'Integration Competition' } }),
  ]);
  await prisma.liga.create({
    data: {
      id: ids.liga,
      nombre: 'Integration League',
      nombreNormalizado: 'integration-league',
      descripcion: 'Data integrity fixture',
      ubicacionId: ids.ubicacion,
      userId: ids.user,
    },
  });
  await prisma.division.create({
    data: {
      id: ids.division,
      nombre: 'Integration Division',
      maxEquipos: 4,
      ligaId: ids.liga,
      estadoLigaId: ids.estado,
      categoriaId: ids.categoria,
      tipoId: ids.tipo,
      tipoCompetenciaId: ids.competencia,
    },
  });
  await prisma.equipo.createMany({
    data: ids.teams.map((id, index) => ({
      id,
      nombre: `Integration Team ${index + 1}`,
      nombreNormalizado: `integration-team-${index + 1}`,
      userId: ids.user,
    })),
  });
  await prisma.divisionEquipo.createMany({
    data: ids.teams.map((equipoId) => ({ divisionId: ids.division, equipoId })),
  });
  await prisma.jugador.create({ data: { id: ids.player, nombre: 'Integration Scorer', posicion: 'DELANTERO' } });
  await prisma.equipoJugador.create({ data: { equipoId: ids.teams[0], jugadorId: ids.player, dorsal: 9 } });
  await prisma.divisionJugador.create({ data: { divisionId: ids.division, equipoId: ids.teams[0], jugadorId: ids.player, dorsal: 9 } });
  await prisma.jornada.create({ data: { id: ids.jornada, numero: 1, divisionId: ids.division } });
  await prisma.rondaPlayoff.create({ data: { id: ids.ronda, nombre: 'Final', orden: 1, divisionId: ids.division } });
  await prisma.partido.createMany({
    data: [
      {
        id: ids.partido1,
        jornadaId: ids.jornada,
        equipoLocalId: ids.teams[0],
        equipoVisitanteId: ids.teams[1],
        estado: 'PROGRAMADO',
        tipoPartido: 'REGULAR',
      },
      {
        id: ids.partido2,
        jornadaId: ids.jornada,
        equipoLocalId: ids.teams[2],
        equipoVisitanteId: ids.teams[3],
        estado: 'PROGRAMADO',
        tipoPartido: 'REGULAR',
      },
    ],
  });
  await prisma.tablaPosicion.createMany({
    data: ids.teams.map((equipoId, index) => ({
      id: `it-integrity-standing-${index + 1}`,
      divisionId: ids.division,
      equipoId,
      puntos: index,
    })),
  });
}

async function cleanupFixture(): Promise<void> {
  await dropFailureTriggers();
  await prisma.liga.deleteMany({ where: { id: ids.liga } });
  await prisma.equipo.deleteMany({ where: { id: { in: [...ids.teams] } } });
  await prisma.jugador.deleteMany({ where: { id: ids.player } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.ubicacion.deleteMany({ where: { id: ids.ubicacion } });
  await Promise.all([
    prisma.categoria.deleteMany({ where: { id: ids.categoria } }),
    prisma.tipo.deleteMany({ where: { id: ids.tipo } }),
    prisma.estadoLiga.deleteMany({ where: { id: ids.estado } }),
    prisma.tipoCompetencia.deleteMany({ where: { id: ids.competencia } }),
  ]);
}

/**
 * Resolves once some session is parked on an ungranted advisory lock in this database.
 * A fixed sleep cannot tell "blocked on the lock" apart from "slow round-trip to a remote
 * database", so the test would still pass with the lock removed.
 */
async function waitForBlockedAdvisoryLock(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_locks
        WHERE locktype = 'advisory'
          AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    if (Number(rows[0].count) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function standingsSnapshot() {
  return prisma.tablaPosicion.findMany({
    where: { divisionId: ids.division },
    orderBy: { equipoId: 'asc' },
  });
}

beforeAll(async () => {
  observer = new Pool({ connectionString: getIntegrationPgConnectionString(), max: 1 });
  const schema = await observer.query<{ exists: boolean }>(
    'SELECT to_regnamespace($1) IS NOT NULL AS exists',
    [INTEGRATION_SCHEMA],
  );
  expect(INTEGRATION_SCHEMA).not.toBe('public');
  expect(schema.rows[0].exists).toBe(true);
});

beforeEach(seedFixture);
afterEach(cleanupFixture);

afterAll(async () => {
  await observer.end();
});

describe('transactional data integrity against PostgreSQL', () => {
  test('removing a player from a team preserves the division roster and dorsal', async () => {
    await prisma.equipoJugador.delete({
      where: { equipoId_jugadorId: { equipoId: ids.teams[0], jugadorId: ids.player } },
    });

    await expect(prisma.divisionJugador.findUniqueOrThrow({
      where: { divisionId_equipoId_jugadorId: { divisionId: ids.division, equipoId: ids.teams[0], jugadorId: ids.player } },
    })).resolves.toMatchObject({ dorsal: 9 });
  });

  test('result allocations enforce constraints, replace atomically, and preserve snapshots after player deletion', async () => {
    const result = await partidoService.updateResult(ids.partido1, {
      expectedVersion: 0,
      estado: 'FINALIZADO',
      golesLocal: 2,
      golesVisitante: 1,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: ids.player, cantidad: 1 }],
    }, owner);

    expect(result).toMatchObject({ version: 1, estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 1 });
    await expect(prisma.anotacionPartido.findMany({
      where: { partidoId: ids.partido1 },
      orderBy: [{ ladoMarcador: 'asc' }, { jugadorId: 'asc' }],
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ jugadorId: ids.player, jugadorNombre: 'Integration Scorer', equipoNombre: 'Integration Team 1', dorsal: 9, cantidad: 1 }),
      expect.objectContaining({ jugadorId: null, ladoMarcador: 'LOCAL', cantidad: 1 }),
      expect.objectContaining({ jugadorId: null, ladoMarcador: 'VISITANTE', cantidad: 1 }),
    ]));

    await expect(prisma.anotacionPartido.create({
      data: { partidoId: ids.partido1, ladoMarcador: 'LOCAL', cantidad: 0 },
    })).rejects.toThrow();

    await prisma.jugador.delete({ where: { id: ids.player } });
    await expect(prisma.anotacionPartido.findFirstOrThrow({
      where: { partidoId: ids.partido1, jugadorNombre: 'Integration Scorer' },
    })).resolves.toMatchObject({ jugadorId: null, jugadorNombre: 'Integration Scorer', dorsal: 9 });
  });

  test('division reset rolls back earlier jornada deletes when ronda deletion fails', async () => {
    const beforeStandings = await standingsSnapshot();
    await installFailureTrigger(triggerNames.reset, triggerNames.resetFunction, 'rondas_playoff', 'DELETE');

    await expect(divisionService.resetDivision(ids.division, owner)).rejects.toThrow('intentional integration failure');

    await expect(prisma.jornada.count({ where: { divisionId: ids.division } })).resolves.toBe(1);
    await expect(prisma.rondaPlayoff.count({ where: { divisionId: ids.division } })).resolves.toBe(1);
    await expect(standingsSnapshot()).resolves.toEqual(beforeStandings);
  });

  test('finalized partido update rolls back when replacement standings cannot be inserted', async () => {
    const beforeMatch = await prisma.partido.findUniqueOrThrow({ where: { id: ids.partido1 } });
    const beforeStandings = await standingsSnapshot();
    await installFailureTrigger(triggerNames.standings, triggerNames.standingsFunction, 'tablas_posicion', 'INSERT');

    await expect(partidoService.update(ids.partido1, {
      estado: 'FINALIZADO',
      golesLocal: 3,
      golesVisitante: 1,
    }, owner)).rejects.toThrow('intentional integration failure');

    await expect(prisma.partido.findUniqueOrThrow({ where: { id: ids.partido1 } })).resolves.toEqual(beforeMatch);
    await expect(standingsSnapshot()).resolves.toEqual(beforeStandings);
  });

  test('jornada delete rolls back the jornada, partidos, and standings when recalculation fails', async () => {
    await prisma.partido.update({
      where: { id: ids.partido1 },
      data: { estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 0 },
    });
    const beforeMatches = await prisma.partido.findMany({
      where: { jornadaId: ids.jornada },
      orderBy: { id: 'asc' },
    });
    const beforeStandings = await standingsSnapshot();
    await installFailureTrigger(triggerNames.standings, triggerNames.standingsFunction, 'tablas_posicion', 'INSERT');

    await expect(jornadaService.delete(ids.jornada, owner)).rejects.toThrow('intentional integration failure');

    await expect(prisma.jornada.count({ where: { id: ids.jornada } })).resolves.toBe(1);
    await expect(prisma.partido.findMany({ where: { jornadaId: ids.jornada }, orderBy: { id: 'asc' } })).resolves.toEqual(beforeMatches);
    await expect(standingsSnapshot()).resolves.toEqual(beforeStandings);
  });

  test('independent clients serialize competing schedule swaps with the shared league lock', async () => {
    const clientA = newPrismaClient('it-integrity-lock-a');
    const clientB = newPrismaClient('it-integrity-lock-b');
    const events: string[] = [];
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((resolve) => { firstLocked = resolve; });

    const swap = async (client: PrismaClient, left: string, right: string, label: string, hold?: Promise<void>) => {
      await client.$transaction(async (tx) => {
        await acquireLeagueScheduleLock(tx, ids.liga);
        events.push(`locked-${label}`);
        if (label === 'a') firstLocked();
        if (hold) await hold;
        const matches = await tx.partido.findMany({
          where: { jornadaId: ids.jornada },
          orderBy: { id: 'asc' },
          select: { id: true, equipoLocalId: true, equipoVisitanteId: true },
        });
        for (const match of matches) {
          const replace = (teamId: string | null) => teamId === left ? right : teamId === right ? left : teamId;
          await tx.partido.update({
            where: { id: match.id },
            data: {
              equipoLocalId: replace(match.equipoLocalId),
              equipoVisitanteId: replace(match.equipoVisitanteId),
            },
          });
        }
        events.push(`written-${label}`);
      });
    };

    try {
      const first = swap(clientA, ids.teams[0], ids.teams[2], 'a', holdFirst);
      await firstHasLock;
      const second = swap(clientB, ids.teams[0], ids.teams[3], 'b');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toEqual(['locked-a']);
      releaseFirst();
      await Promise.all([first, second]);

      expect(events).toEqual(['locked-a', 'written-a', 'locked-b', 'written-b']);
      const schedule = await prisma.partido.findMany({
        where: { jornadaId: ids.jornada },
        orderBy: { id: 'asc' },
        select: { equipoLocalId: true, equipoVisitanteId: true },
      });
      expect(schedule).toEqual([
        { equipoLocalId: ids.teams[2], equipoVisitanteId: ids.teams[1] },
        { equipoLocalId: ids.teams[3], equipoVisitanteId: ids.teams[0] },
      ]);
      const participants = schedule.flatMap((match) => [match.equipoLocalId, match.equipoVisitanteId]);
      expect(new Set(participants).size).toBe(ids.teams.length);
      expect(participants).toEqual(expect.arrayContaining([...ids.teams]));
    } finally {
      releaseFirst();
      await Promise.allSettled([clientA.$disconnect(), clientB.$disconnect()]);
    }
  });

  test('deleting a court waits for the league lock and never orphans a concurrently scheduled match', async () => {
    const canchaId = 'it-integrity-court';
    await prisma.ligaCancha.create({
      data: { id: canchaId, nombre: 'Cancha Integracion', nombreNormalizado: 'cancha integracion', ligaId: ids.liga },
    });

    const writer = newPrismaClient('it-integrity-court-writer');
    const events: string[] = [];
    let releaseWriter!: () => void;
    const holdWriter = new Promise<void>((resolve) => { releaseWriter = resolve; });
    let writerLocked!: () => void;
    const writerHasLock = new Promise<void>((resolve) => { writerLocked = resolve; });

    const scheduleMatch = writer.$transaction(async (tx) => {
      await acquireLeagueScheduleLock(tx, ids.liga);
      events.push('locked-writer');
      writerLocked();
      await holdWriter;
      await tx.partido.update({
        where: { id: ids.partido1 },
        data: {
          canchaId,
          fecha: new Date('2099-01-01T18:00:00.000Z'),
          fechaFin: new Date('2099-01-01T19:00:00.000Z'),
        },
      });
      events.push('written-writer');
    });

    try {
      await writerHasLock;
      const deletion = ligaService.deleteCancha(ids.liga, canchaId, owner).then(() => { events.push('deleted'); });
      // Must be parked on the advisory lock rather than racing its own match count.
      await expect(waitForBlockedAdvisoryLock()).resolves.toBe(true);
      expect(events).toEqual(['locked-writer']);
      releaseWriter();
      await Promise.all([scheduleMatch, deletion]);

      expect(events).toEqual(['locked-writer', 'written-writer', 'deleted']);
      // Re-reading under the lock sees the new match, so the court is deactivated, not dropped.
      await expect(prisma.ligaCancha.findUniqueOrThrow({ where: { id: canchaId } }))
        .resolves.toMatchObject({ activa: false });
      // No scheduled match was left without a court by onDelete: SetNull.
      await expect(prisma.partido.count({
        where: { jornadaId: ids.jornada, canchaId: null, fecha: { not: null } },
      })).resolves.toBe(0);
    } finally {
      releaseWriter();
      await writer.$disconnect();
    }
  });
});
