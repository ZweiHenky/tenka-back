"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const vitest_1 = require("vitest");
const client_1 = require("../../generated/prisma/client");
const database_1 = require("../../config/database");
const service_1 = require("../../modules/division/service");
const service_2 = require("../../modules/jornada/service");
const service_3 = require("../../modules/liga/service");
const service_4 = require("../../modules/partido/service");
const leagueScheduleLock_1 = require("../../utils/leagueScheduleLock");
const database_2 = require("./database");
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
};
const owner = {
    id: ids.user,
    email: 'it-integrity-owner@example.test',
    rol: 'LIGA',
};
const triggerNames = {
    reset: 'it_fail_reset_round_delete',
    resetFunction: 'it_fail_reset_round_delete_fn',
    standings: 'it_fail_standings_insert',
    standingsFunction: 'it_fail_standings_insert_fn',
};
let observer;
function newPrismaClient(applicationName) {
    const connectionString = new URL((0, database_2.getIntegrationPgConnectionString)());
    connectionString.searchParams.set('application_name', applicationName);
    return new client_1.PrismaClient({
        adapter: new adapter_pg_1.PrismaPg({ connectionString: connectionString.href, max: 1 }, { schema: database_2.INTEGRATION_SCHEMA }),
    });
}
async function installFailureTrigger(trigger, functionName, table, operation) {
    if (database_2.INTEGRATION_SCHEMA === 'public')
        throw new Error('Integration DDL must never target public');
    await observer.query(`
    CREATE OR REPLACE FUNCTION "${database_2.INTEGRATION_SCHEMA}"."${functionName}"()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'intentional integration failure';
    END;
    $$;
    CREATE TRIGGER "${trigger}"
    BEFORE ${operation} ON "${database_2.INTEGRATION_SCHEMA}"."${table}"
    FOR EACH STATEMENT EXECUTE FUNCTION "${database_2.INTEGRATION_SCHEMA}"."${functionName}"();
  `);
}
async function dropFailureTriggers() {
    if (database_2.INTEGRATION_SCHEMA === 'public')
        throw new Error('Integration DDL must never target public');
    await observer.query(`
    DROP TRIGGER IF EXISTS "${triggerNames.reset}" ON "${database_2.INTEGRATION_SCHEMA}"."rondas_playoff";
    DROP FUNCTION IF EXISTS "${database_2.INTEGRATION_SCHEMA}"."${triggerNames.resetFunction}"();
    DROP TRIGGER IF EXISTS "${triggerNames.standings}" ON "${database_2.INTEGRATION_SCHEMA}"."tablas_posicion";
    DROP FUNCTION IF EXISTS "${database_2.INTEGRATION_SCHEMA}"."${triggerNames.standingsFunction}"();
  `);
}
async function seedFixture() {
    await database_1.prisma.user.create({
        data: { id: ids.user, email: owner.email, name: 'Integration Owner', rol: 'LIGA' },
    });
    await database_1.prisma.ubicacion.create({
        data: { id: ids.ubicacion, lat: 19.4326, lng: -99.1332, nombreCompleto: 'Integration Venue', estado: 'Test', municipio: 'Test', timeZone: 'America/Mexico_City' },
    });
    await Promise.all([
        database_1.prisma.categoria.create({ data: { id: ids.categoria, nombre: 'Integration Category' } }),
        database_1.prisma.tipo.create({ data: { id: ids.tipo, nombre: 'Integration Type' } }),
        database_1.prisma.estadoLiga.create({ data: { id: ids.estado, nombre: 'En Curso' } }),
        database_1.prisma.tipoCompetencia.create({ data: { id: ids.competencia, nombre: 'Integration Competition' } }),
    ]);
    await database_1.prisma.liga.create({
        data: {
            id: ids.liga,
            nombre: 'Integration League',
            nombreNormalizado: 'integration-league',
            descripcion: 'Data integrity fixture',
            ubicacionId: ids.ubicacion,
            userId: ids.user,
        },
    });
    await database_1.prisma.division.create({
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
    await database_1.prisma.equipo.createMany({
        data: ids.teams.map((id, index) => ({
            id,
            nombre: `Integration Team ${index + 1}`,
            nombreNormalizado: `integration-team-${index + 1}`,
            userId: ids.user,
        })),
    });
    await database_1.prisma.divisionEquipo.createMany({
        data: ids.teams.map((equipoId) => ({ divisionId: ids.division, equipoId })),
    });
    await database_1.prisma.jugador.create({ data: { id: ids.player, nombre: 'Integration Scorer', posicion: 'DELANTERO' } });
    await database_1.prisma.equipoJugador.create({ data: { equipoId: ids.teams[0], jugadorId: ids.player, dorsal: 9 } });
    await database_1.prisma.divisionJugador.create({ data: { divisionId: ids.division, equipoId: ids.teams[0], jugadorId: ids.player, dorsal: 9 } });
    await database_1.prisma.jornada.create({ data: { id: ids.jornada, numero: 1, divisionId: ids.division } });
    await database_1.prisma.rondaPlayoff.create({ data: { id: ids.ronda, nombre: 'Final', orden: 1, divisionId: ids.division } });
    await database_1.prisma.partido.createMany({
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
    await database_1.prisma.tablaPosicion.createMany({
        data: ids.teams.map((equipoId, index) => ({
            id: `it-integrity-standing-${index + 1}`,
            divisionId: ids.division,
            equipoId,
            puntos: index,
        })),
    });
}
async function cleanupFixture() {
    await dropFailureTriggers();
    await database_1.prisma.liga.deleteMany({ where: { id: ids.liga } });
    await database_1.prisma.equipo.deleteMany({ where: { id: { in: [...ids.teams] } } });
    await database_1.prisma.jugador.deleteMany({ where: { id: ids.player } });
    await database_1.prisma.user.deleteMany({ where: { id: ids.user } });
    await database_1.prisma.ubicacion.deleteMany({ where: { id: ids.ubicacion } });
    await Promise.all([
        database_1.prisma.categoria.deleteMany({ where: { id: ids.categoria } }),
        database_1.prisma.tipo.deleteMany({ where: { id: ids.tipo } }),
        database_1.prisma.estadoLiga.deleteMany({ where: { id: ids.estado } }),
        database_1.prisma.tipoCompetencia.deleteMany({ where: { id: ids.competencia } }),
    ]);
}
/**
 * Resolves once some session is parked on an ungranted advisory lock in this database.
 * A fixed sleep cannot tell "blocked on the lock" apart from "slow round-trip to a remote
 * database", so the test would still pass with the lock removed.
 */
async function waitForBlockedAdvisoryLock(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { rows } = await observer.query(`SELECT count(*)::text AS count
         FROM pg_locks
        WHERE locktype = 'advisory'
          AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
        if (Number(rows[0].count) > 0)
            return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}
async function standingsSnapshot() {
    return database_1.prisma.tablaPosicion.findMany({
        where: { divisionId: ids.division },
        orderBy: { equipoId: 'asc' },
    });
}
(0, vitest_1.beforeAll)(async () => {
    observer = new pg_1.Pool({ connectionString: (0, database_2.getIntegrationPgConnectionString)(), max: 1 });
    const schema = await observer.query('SELECT to_regnamespace($1) IS NOT NULL AS exists', [database_2.INTEGRATION_SCHEMA]);
    (0, vitest_1.expect)(database_2.INTEGRATION_SCHEMA).not.toBe('public');
    (0, vitest_1.expect)(schema.rows[0].exists).toBe(true);
});
(0, vitest_1.beforeEach)(seedFixture);
(0, vitest_1.afterEach)(cleanupFixture);
(0, vitest_1.afterAll)(async () => {
    await observer.end();
});
(0, vitest_1.describe)('transactional data integrity against PostgreSQL', () => {
    (0, vitest_1.test)('removing a player from a team preserves the division roster and dorsal', async () => {
        await database_1.prisma.equipoJugador.delete({
            where: { equipoId_jugadorId: { equipoId: ids.teams[0], jugadorId: ids.player } },
        });
        await (0, vitest_1.expect)(database_1.prisma.divisionJugador.findUniqueOrThrow({
            where: { divisionId_equipoId_jugadorId: { divisionId: ids.division, equipoId: ids.teams[0], jugadorId: ids.player } },
        })).resolves.toMatchObject({ dorsal: 9 });
    });
    (0, vitest_1.test)('result allocations enforce constraints, replace atomically, and preserve snapshots after player deletion', async () => {
        const result = await service_4.partidoService.updateResult(ids.partido1, {
            expectedVersion: 0,
            estado: 'FINALIZADO',
            golesLocal: 2,
            golesVisitante: 1,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: ids.player, cantidad: 1 }],
        }, owner);
        (0, vitest_1.expect)(result).toMatchObject({ version: 1, estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 1 });
        await (0, vitest_1.expect)(database_1.prisma.anotacionPartido.findMany({
            where: { partidoId: ids.partido1 },
            orderBy: [{ ladoMarcador: 'asc' }, { jugadorId: 'asc' }],
        })).resolves.toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({ jugadorId: ids.player, jugadorNombre: 'Integration Scorer', equipoNombre: 'Integration Team 1', dorsal: 9, cantidad: 1 }),
            vitest_1.expect.objectContaining({ jugadorId: null, ladoMarcador: 'LOCAL', cantidad: 1 }),
            vitest_1.expect.objectContaining({ jugadorId: null, ladoMarcador: 'VISITANTE', cantidad: 1 }),
        ]));
        await (0, vitest_1.expect)(database_1.prisma.anotacionPartido.create({
            data: { partidoId: ids.partido1, ladoMarcador: 'LOCAL', cantidad: 0 },
        })).rejects.toThrow();
        await database_1.prisma.jugador.delete({ where: { id: ids.player } });
        await (0, vitest_1.expect)(database_1.prisma.anotacionPartido.findFirstOrThrow({
            where: { partidoId: ids.partido1, jugadorNombre: 'Integration Scorer' },
        })).resolves.toMatchObject({ jugadorId: null, jugadorNombre: 'Integration Scorer', dorsal: 9 });
    });
    (0, vitest_1.test)('division reset rolls back earlier jornada deletes when ronda deletion fails', async () => {
        const beforeStandings = await standingsSnapshot();
        await installFailureTrigger(triggerNames.reset, triggerNames.resetFunction, 'rondas_playoff', 'DELETE');
        await (0, vitest_1.expect)(service_1.divisionService.resetDivision(ids.division, owner)).rejects.toThrow('intentional integration failure');
        await (0, vitest_1.expect)(database_1.prisma.jornada.count({ where: { divisionId: ids.division } })).resolves.toBe(1);
        await (0, vitest_1.expect)(database_1.prisma.rondaPlayoff.count({ where: { divisionId: ids.division } })).resolves.toBe(1);
        await (0, vitest_1.expect)(standingsSnapshot()).resolves.toEqual(beforeStandings);
    });
    (0, vitest_1.test)('finalized partido update rolls back when replacement standings cannot be inserted', async () => {
        const beforeMatch = await database_1.prisma.partido.findUniqueOrThrow({ where: { id: ids.partido1 } });
        const beforeStandings = await standingsSnapshot();
        await installFailureTrigger(triggerNames.standings, triggerNames.standingsFunction, 'tablas_posicion', 'INSERT');
        await (0, vitest_1.expect)(service_4.partidoService.update(ids.partido1, {
            estado: 'FINALIZADO',
            golesLocal: 3,
            golesVisitante: 1,
        }, owner)).rejects.toThrow('intentional integration failure');
        await (0, vitest_1.expect)(database_1.prisma.partido.findUniqueOrThrow({ where: { id: ids.partido1 } })).resolves.toEqual(beforeMatch);
        await (0, vitest_1.expect)(standingsSnapshot()).resolves.toEqual(beforeStandings);
    });
    (0, vitest_1.test)('jornada delete rolls back the jornada, partidos, and standings when recalculation fails', async () => {
        await database_1.prisma.partido.update({
            where: { id: ids.partido1 },
            data: { estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 0 },
        });
        const beforeMatches = await database_1.prisma.partido.findMany({
            where: { jornadaId: ids.jornada },
            orderBy: { id: 'asc' },
        });
        const beforeStandings = await standingsSnapshot();
        await installFailureTrigger(triggerNames.standings, triggerNames.standingsFunction, 'tablas_posicion', 'INSERT');
        await (0, vitest_1.expect)(service_2.jornadaService.delete(ids.jornada, owner)).rejects.toThrow('intentional integration failure');
        await (0, vitest_1.expect)(database_1.prisma.jornada.count({ where: { id: ids.jornada } })).resolves.toBe(1);
        await (0, vitest_1.expect)(database_1.prisma.partido.findMany({ where: { jornadaId: ids.jornada }, orderBy: { id: 'asc' } })).resolves.toEqual(beforeMatches);
        await (0, vitest_1.expect)(standingsSnapshot()).resolves.toEqual(beforeStandings);
    });
    (0, vitest_1.test)('independent clients serialize competing schedule swaps with the shared league lock', async () => {
        const clientA = newPrismaClient('it-integrity-lock-a');
        const clientB = newPrismaClient('it-integrity-lock-b');
        const events = [];
        let releaseFirst;
        const holdFirst = new Promise((resolve) => { releaseFirst = resolve; });
        let firstLocked;
        const firstHasLock = new Promise((resolve) => { firstLocked = resolve; });
        const swap = async (client, left, right, label, hold) => {
            await client.$transaction(async (tx) => {
                await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ids.liga);
                events.push(`locked-${label}`);
                if (label === 'a')
                    firstLocked();
                if (hold)
                    await hold;
                const matches = await tx.partido.findMany({
                    where: { jornadaId: ids.jornada },
                    orderBy: { id: 'asc' },
                    select: { id: true, equipoLocalId: true, equipoVisitanteId: true },
                });
                for (const match of matches) {
                    const replace = (teamId) => teamId === left ? right : teamId === right ? left : teamId;
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
            (0, vitest_1.expect)(events).toEqual(['locked-a']);
            releaseFirst();
            await Promise.all([first, second]);
            (0, vitest_1.expect)(events).toEqual(['locked-a', 'written-a', 'locked-b', 'written-b']);
            const schedule = await database_1.prisma.partido.findMany({
                where: { jornadaId: ids.jornada },
                orderBy: { id: 'asc' },
                select: { equipoLocalId: true, equipoVisitanteId: true },
            });
            (0, vitest_1.expect)(schedule).toEqual([
                { equipoLocalId: ids.teams[2], equipoVisitanteId: ids.teams[1] },
                { equipoLocalId: ids.teams[3], equipoVisitanteId: ids.teams[0] },
            ]);
            const participants = schedule.flatMap((match) => [match.equipoLocalId, match.equipoVisitanteId]);
            (0, vitest_1.expect)(new Set(participants).size).toBe(ids.teams.length);
            (0, vitest_1.expect)(participants).toEqual(vitest_1.expect.arrayContaining([...ids.teams]));
        }
        finally {
            releaseFirst();
            await Promise.allSettled([clientA.$disconnect(), clientB.$disconnect()]);
        }
    });
    (0, vitest_1.test)('deleting a court waits for the league lock and never orphans a concurrently scheduled match', async () => {
        const canchaId = 'it-integrity-court';
        await database_1.prisma.ligaCancha.create({
            data: { id: canchaId, nombre: 'Cancha Integracion', nombreNormalizado: 'cancha integracion', ligaId: ids.liga },
        });
        const writer = newPrismaClient('it-integrity-court-writer');
        const events = [];
        let releaseWriter;
        const holdWriter = new Promise((resolve) => { releaseWriter = resolve; });
        let writerLocked;
        const writerHasLock = new Promise((resolve) => { writerLocked = resolve; });
        const scheduleMatch = writer.$transaction(async (tx) => {
            await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ids.liga);
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
            const deletion = service_3.ligaService.deleteCancha(ids.liga, canchaId, owner).then(() => { events.push('deleted'); });
            // Must be parked on the advisory lock rather than racing its own match count.
            await (0, vitest_1.expect)(waitForBlockedAdvisoryLock()).resolves.toBe(true);
            (0, vitest_1.expect)(events).toEqual(['locked-writer']);
            releaseWriter();
            await Promise.all([scheduleMatch, deletion]);
            (0, vitest_1.expect)(events).toEqual(['locked-writer', 'written-writer', 'deleted']);
            // Re-reading under the lock sees the new match, so the court is deactivated, not dropped.
            await (0, vitest_1.expect)(database_1.prisma.ligaCancha.findUniqueOrThrow({ where: { id: canchaId } }))
                .resolves.toMatchObject({ activa: false });
            // No scheduled match was left without a court by onDelete: SetNull.
            await (0, vitest_1.expect)(database_1.prisma.partido.count({
                where: { jornadaId: ids.jornada, canchaId: null, fecha: { not: null } },
            })).resolves.toBe(0);
        }
        finally {
            releaseWriter();
            await writer.$disconnect();
        }
    });
});
//# sourceMappingURL=data-integrity.integration.test.js.map