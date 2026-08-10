"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const vitest_1 = require("vitest");
const node_crypto_1 = require("node:crypto");
const client_1 = require("../../generated/prisma/client");
const scheduleChangeOutbox_1 = require("../../modules/notification/scheduleChangeOutbox");
const database_1 = require("./database");
let prisma;
let observer;
(0, vitest_1.beforeAll)(() => {
    const connectionString = (0, database_1.getIntegrationPgConnectionString)();
    prisma = new client_1.PrismaClient({
        adapter: new adapter_pg_1.PrismaPg({ connectionString, max: 1 }, { schema: database_1.INTEGRATION_SCHEMA }),
    });
    observer = new pg_1.Pool({ connectionString, max: 4 });
});
async function createDivisionFixture(suffix) {
    const user = await prisma.user.create({ data: { id: `user-${suffix}`, email: `${suffix}@integration.test` } });
    const ubicacion = await prisma.ubicacion.create({ data: { id: `location-${suffix}`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test' } });
    const liga = await prisma.liga.create({ data: { id: `league-${suffix}`, nombre: 'Test', nombreNormalizado: `test-${suffix}`, descripcion: 'Test', userId: user.id, ubicacionId: ubicacion.id } });
    const [categoria, tipo, estadoLiga, tipoCompetencia] = await Promise.all([
        prisma.categoria.create({ data: { id: `category-${suffix}`, nombre: 'Test' } }),
        prisma.tipo.create({ data: { id: `type-${suffix}`, nombre: 'Test' } }),
        prisma.estadoLiga.create({ data: { id: `status-${suffix}`, nombre: 'En Curso' } }),
        prisma.tipoCompetencia.create({ data: { id: `competition-${suffix}`, nombre: 'Test' } }),
    ]);
    const division = await prisma.division.create({ data: {
            id: `division-${suffix}`, nombre: 'Test', maxEquipos: 8, ligaId: liga.id,
            categoriaId: categoria.id, tipoId: tipo.id, estadoLigaId: estadoLiga.id, tipoCompetenciaId: tipoCompetencia.id,
        } });
    return division.id;
}
(0, vitest_1.afterAll)(async () => {
    await prisma.$disconnect();
    await observer.end();
});
(0, vitest_1.test)('a rolled-back Prisma transaction is never visible to an independent pg connection', async () => {
    const id = `rollback-${Date.now()}`;
    const rollback = new Error('intentional rollback');
    await (0, vitest_1.expect)(prisma.$transaction(async (transaction) => {
        await transaction.categoria.create({ data: { id, nombre: 'rollback smoke test' } });
        const duringTransaction = await observer.query(`SELECT count(*) FROM "${database_1.INTEGRATION_SCHEMA}"."categorias" WHERE id = $1`, [id]);
        (0, vitest_1.expect)(Number(duringTransaction.rows[0].count)).toBe(0);
        throw rollback;
    })).rejects.toBe(rollback);
    const afterRollback = await observer.query(`SELECT count(*) FROM "${database_1.INTEGRATION_SCHEMA}"."categorias" WHERE id = $1`, [id]);
    (0, vitest_1.expect)(Number(afterRollback.rows[0].count)).toBe(0);
});
(0, vitest_1.test)('jornada and notification outbox rows roll back together', async () => {
    const suffix = `outbox-rollback-${Date.now()}`;
    const divisionId = await createDivisionFixture(suffix);
    const jornadaId = `jornada-${suffix}`;
    await (0, vitest_1.expect)(prisma.$transaction(async (transaction) => {
        await transaction.jornada.create({ data: { id: jornadaId, numero: 1, divisionId } });
        await transaction.notificationOutbox.createMany({ data: [
                { eventKey: `jornada-generated:${jornadaId}:registered`, jornadaId, divisionId, audience: 'REGISTERED', providerIdempotencyKey: (0, node_crypto_1.randomUUID)() },
                { eventKey: `jornada-generated:${jornadaId}:followers`, jornadaId, divisionId, audience: 'FOLLOWERS', providerIdempotencyKey: (0, node_crypto_1.randomUUID)() },
            ] });
        throw new Error('intentional outbox rollback');
    })).rejects.toThrow('intentional outbox rollback');
    (0, vitest_1.expect)(await prisma.jornada.count({ where: { id: jornadaId } })).toBe(0);
    (0, vitest_1.expect)(await prisma.notificationOutbox.count({ where: { jornadaId } })).toBe(0);
});
(0, vitest_1.test)('two workers claim each outbox row exactly once with skip locked', async () => {
    const suffix = `outbox-claim-${Date.now()}`;
    const divisionId = await createDivisionFixture(suffix);
    const jornada = await prisma.jornada.create({ data: { id: `jornada-${suffix}`, numero: 1, divisionId } });
    await prisma.notificationOutbox.createMany({ data: Array.from({ length: 6 }, (_, index) => ({
            eventKey: `claim:${suffix}:${index}`,
            jornadaId: jornada.id,
            divisionId,
            audience: index % 2 ? 'FOLLOWERS' : 'REGISTERED',
            providerIdempotencyKey: (0, node_crypto_1.randomUUID)(),
        })) });
    const claim = async (workerId) => observer.query(`
    WITH due AS (
      SELECT id FROM "${database_1.INTEGRATION_SCHEMA}".notification_outbox
      WHERE status = 'PENDING' AND "nextAttemptAt" <= NOW()
      ORDER BY "nextAttemptAt" FOR UPDATE SKIP LOCKED LIMIT 3
    )
    UPDATE "${database_1.INTEGRATION_SCHEMA}".notification_outbox job
    SET status = 'PROCESSING', "lockedBy" = $1, "leaseUntil" = NOW() + INTERVAL '60 seconds', "updatedAt" = NOW()
    FROM due WHERE job.id = due.id RETURNING job.id
  `, [workerId]);
    const [first, second] = await Promise.all([claim('worker-a'), claim('worker-b')]);
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    (0, vitest_1.expect)(ids).toHaveLength(6);
    (0, vitest_1.expect)(new Set(ids).size).toBe(6);
    (0, vitest_1.expect)(first.rows).toHaveLength(3);
    (0, vitest_1.expect)(second.rows).toHaveLength(3);
});
(0, vitest_1.test)('schedule changes merge atomically and retain one provider idempotency key', async () => {
    const suffix = `schedule-merge-${Date.now()}`;
    const divisionId = await createDivisionFixture(suffix);
    const division = await prisma.division.findUniqueOrThrow({ where: { id: divisionId }, select: { ligaId: true } });
    await prisma.user.createMany({ data: [
            { id: `owner-a-${suffix}`, email: `owner-a-${suffix}@integration.test` },
            { id: `owner-b-${suffix}`, email: `owner-b-${suffix}@integration.test` },
        ] });
    await prisma.equipo.createMany({ data: [
            { id: `team-a-${suffix}`, nombre: 'A', nombreNormalizado: `a-${suffix}`, userId: `owner-a-${suffix}` },
            { id: `team-b-${suffix}`, nombre: 'B', nombreNormalizado: `b-${suffix}`, userId: `owner-b-${suffix}` },
        ] });
    await prisma.$transaction((tx) => (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
        divisionId, ligaId: division.ligaId,
        changes: { teamIds: [`team-a-${suffix}`], jornadaIds: ['jornada-a'], partidoIds: ['partido-a'] },
    }));
    const first = await prisma.notificationOutbox.findFirstOrThrow({ where: { aggregationKey: `schedule-change:${divisionId}` } });
    await prisma.$transaction((tx) => (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
        divisionId, ligaId: division.ligaId,
        changes: { teamIds: [`team-b-${suffix}`], jornadaIds: ['jornada-b'], partidoIds: ['partido-b'] },
    }));
    const rows = await prisma.notificationOutbox.findMany({ where: { divisionId, eventType: 'SCHEDULE_CHANGED' } });
    (0, vitest_1.expect)(rows).toHaveLength(1);
    (0, vitest_1.expect)(rows[0].providerIdempotencyKey).toBe(first.providerIdempotencyKey);
    (0, vitest_1.expect)(rows[0].targetUserIds).toEqual([`owner-a-${suffix}`, `owner-b-${suffix}`]);
    (0, vitest_1.expect)(rows[0].payload).toMatchObject({
        jornadaIds: ['jornada-a', 'jornada-b'],
        partidoIds: ['partido-a', 'partido-b'],
    });
    (0, vitest_1.expect)(rows[0].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(first.nextAttemptAt.getTime());
});
(0, vitest_1.test)('claim clearing the aggregation key lets a concurrent schedule change create a fresh pending event', async () => {
    const suffix = `schedule-claim-${Date.now()}`;
    const divisionId = await createDivisionFixture(suffix);
    const division = await prisma.division.findUniqueOrThrow({ where: { id: divisionId }, select: { ligaId: true } });
    const ownerId = `owner-${suffix}`;
    const teamId = `team-${suffix}`;
    await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@integration.test` } });
    await prisma.equipo.create({ data: { id: teamId, nombre: 'Team', nombreNormalizado: suffix, userId: ownerId } });
    const enqueue = (partidoId) => prisma.$transaction((tx) => (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
        divisionId, ligaId: division.ligaId,
        changes: { teamIds: [teamId], jornadaIds: ['jornada'], partidoIds: [partidoId] },
    }));
    await enqueue('partido-a');
    await prisma.notificationOutbox.updateMany({ where: { aggregationKey: `schedule-change:${divisionId}` }, data: { nextAttemptAt: new Date(0) } });
    const claimed = await observer.query(`
    WITH due AS (
      SELECT id FROM "${database_1.INTEGRATION_SCHEMA}".notification_outbox
      WHERE status = 'PENDING' AND "nextAttemptAt" <= NOW()
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "${database_1.INTEGRATION_SCHEMA}".notification_outbox job
    SET status = 'PROCESSING', "aggregationKey" = NULL, "updatedAt" = NOW()
    FROM due WHERE job.id = due.id RETURNING job.id
  `);
    (0, vitest_1.expect)(claimed.rows).toHaveLength(1);
    await enqueue('partido-b');
    const rows = await prisma.notificationOutbox.findMany({ where: { divisionId, eventType: 'SCHEDULE_CHANGED' }, orderBy: { createdAt: 'asc' } });
    (0, vitest_1.expect)(rows).toHaveLength(2);
    (0, vitest_1.expect)(rows[0].status).toBe('PROCESSING');
    (0, vitest_1.expect)(rows[0].aggregationKey).toBeNull();
    (0, vitest_1.expect)(rows[1].status).toBe('PENDING');
    (0, vitest_1.expect)(rows[1].aggregationKey).toBe(`schedule-change:${divisionId}`);
    (0, vitest_1.expect)(rows[1].providerIdempotencyKey).not.toBe(rows[0].providerIdempotencyKey);
});
//# sourceMappingURL=transaction.integration.test.js.map