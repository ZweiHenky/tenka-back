"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arbitrajeService = exports.overlaps = void 0;
exports.planLeagueAssignments = planLeagueAssignments;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
const authorization_1 = require("../../utils/authorization");
const overlaps = (a, b, c, d) => a < d && b > c;
exports.overlaps = overlaps;
function planLeagueAssignments(divisionIds, assignments, divisions, activeRefereeIds, existing = []) {
    if (new Set(divisionIds).size !== divisionIds.length)
        throw new errors_1.ValidationError('Las divisiones no pueden repetirse');
    if (divisions.length !== divisionIds.length)
        throw new errors_1.ValidationError('Todas las divisiones deben pertenecer a la liga');
    const partidoIds = assignments.map((assignment) => assignment.partidoId);
    if (new Set(partidoIds).size !== partidoIds.length)
        throw new errors_1.ValidationError('Los partidos no pueden repetirse');
    const matches = new Map(divisions.flatMap((division) => division.partidos).map((match) => [match.id, match]));
    const active = new Set(activeRefereeIds);
    const intervals = new Map();
    for (const row of existing) {
        if (row.fecha && row.fechaFin)
            intervals.set(row.arbitroId, [...(intervals.get(row.arbitroId) ?? []), { start: row.fecha, end: row.fechaFin }]);
    }
    const rows = [];
    for (const assignment of assignments) {
        const match = matches.get(assignment.partidoId);
        if (!match)
            throw new errors_1.ValidationError('Todos los partidos deben pertenecer a una división seleccionada');
        if (new Set(assignment.arbitroIds).size !== assignment.arbitroIds.length)
            throw new errors_1.ValidationError('Los árbitros no pueden repetirse en un partido');
        if (assignment.arbitroIds.some((id) => !active.has(id)))
            throw new errors_1.ValidationError('Todos los árbitros deben estar activos y pertenecer a la liga');
        if (assignment.arbitroIds.length && (!match.fecha || !match.fechaFin || match.fecha >= match.fechaFin))
            throw new errors_1.ValidationError('Los partidos con árbitros deben tener fecha y fechaFin válidas');
        for (const arbitroId of assignment.arbitroIds) {
            if ((intervals.get(arbitroId) ?? []).some((interval) => (0, exports.overlaps)(match.fecha, match.fechaFin, interval.start, interval.end))) {
                throw new errors_1.ValidationError('Un árbitro no puede tener partidos en horarios traslapados');
            }
            intervals.set(arbitroId, [...(intervals.get(arbitroId) ?? []), { start: match.fecha, end: match.fechaFin }]);
            rows.push({ partidoId: assignment.partidoId, arbitroId });
        }
    }
    return rows;
}
const partidoRelations = {
    equipoLocal: { select: { id: true, nombre: true, logo: true } }, equipoVisitante: { select: { id: true, nombre: true, logo: true } },
    cancha: { select: { id: true, nombre: true } }, arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
};
const partidoInclude = {
    jornada: { select: { id: true, numero: true, division: { select: { id: true, nombre: true } } } },
    rondaPlayoff: { select: { id: true, nombre: true, division: { select: { id: true, nombre: true } } } },
    ...partidoRelations,
};
async function ownLeague(ligaId, actor) {
    const league = await database_1.prisma.liga.findUnique({ where: { id: ligaId }, select: { userId: true } });
    if (!league)
        throw new errors_1.NotFoundError('Liga');
    (0, authorization_1.assertOwnerOrAdmin)(actor, league.userId, 'Liga');
}
async function ownBatch(ligaId, tandaId, actor) {
    const batch = await database_1.prisma.tandaArbitral.findFirst({
        where: { id: tandaId, ligaId },
        select: { id: true, ligaId: true, liga: { select: { userId: true } } },
    });
    if (!batch)
        throw new errors_1.NotFoundError('Tanda arbitral');
    (0, authorization_1.assertOwnerOrAdmin)(actor, batch.liga.userId, 'Liga');
    return batch;
}
async function activeReferees(ligaId, ids) {
    const rows = await database_1.prisma.ligaArbitro.findMany({ where: { ligaId, activo: true, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, nombre: true } });
    if (ids && rows.length !== ids.length)
        throw new errors_1.ValidationError('Todos los árbitros deben estar activos y pertenecer a la liga');
    return rows;
}
exports.arbitrajeService = {
    async list(ligaId, actor) {
        const league = await database_1.prisma.liga.findUnique({
            where: { id: ligaId },
            select: { userId: true, tandasArbitrales: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { partidos: true } } } } },
        });
        if (!league)
            throw new errors_1.NotFoundError('Liga');
        (0, authorization_1.assertOwnerOrAdmin)(actor, league.userId, 'Liga');
        return league.tandasArbitrales;
    },
    async detail(ligaId, tandaId, actor) {
        const row = await database_1.prisma.tandaArbitral.findFirst({
            where: { id: tandaId, ligaId },
            include: { liga: { select: { userId: true } }, partidos: { include: { partido: { include: partidoInclude } } } },
        });
        if (!row)
            throw new errors_1.NotFoundError('Tanda arbitral');
        (0, authorization_1.assertOwnerOrAdmin)(actor, row.liga.userId, 'Liga');
        const { liga: _liga, ...batch } = row;
        return { ...batch, partidos: row.partidos.map((p) => ({ ...p.partido, arbitros: p.partido.arbitros.map((a) => a.arbitro) })) };
    },
    async candidates(ligaId, actor) {
        const league = await database_1.prisma.liga.findUnique({
            where: { id: ligaId },
            select: { userId: true, divisiones: { select: { id: true, nombre: true, jornadas: { orderBy: { numero: 'asc' }, select: { id: true, numero: true, partidos: { where: { tandas: { none: {} } }, orderBy: { fecha: 'asc' }, include: partidoRelations } } }, rondasPlayoff: { orderBy: { orden: 'asc' }, select: { id: true, nombre: true, orden: true, partidos: { where: { tandas: { none: {} } }, orderBy: { fecha: 'asc' }, include: partidoRelations } } } } } },
        });
        if (!league)
            throw new errors_1.NotFoundError('Liga');
        (0, authorization_1.assertOwnerOrAdmin)(actor, league.userId, 'Liga');
        return league.divisiones.map((division) => ({
            ...division,
            jornadas: division.jornadas.map((jornada) => ({
                ...jornada,
                partidos: jornada.partidos.map((partido) => ({ ...partido, jornada: { id: jornada.id, numero: jornada.numero, division: { id: division.id, nombre: division.nombre } }, rondaPlayoff: null, arbitros: partido.arbitros.map((row) => row.arbitro) })),
            })),
            rondasPlayoff: division.rondasPlayoff.map((ronda) => ({
                ...ronda,
                partidos: ronda.partidos.map((partido) => ({ ...partido, jornada: null, rondaPlayoff: { id: ronda.id, nombre: ronda.nombre, division: { id: division.id, nombre: division.nombre } }, arbitros: partido.arbitros.map((row) => row.arbitro) })),
            })),
        }));
    },
    async removeAssignment(ligaId, assignmentId, actor) {
        await ownBatch(ligaId, assignmentId, actor);
        const links = await database_1.prisma.tandaArbitralPartido.findMany({ where: { tandaId: assignmentId }, select: { partidoId: true } });
        const partidoIds = links.map((link) => link.partidoId);
        await database_1.prisma.$transaction([
            database_1.prisma.partidoArbitro.deleteMany({ where: { partidoId: { in: partidoIds } } }),
            database_1.prisma.tandaArbitral.delete({ where: { id: assignmentId } }),
        ]);
    },
    async replaceLeagueAssignments(ligaId, actor, data) {
        const partidoIds = data.asignaciones.map((assignment) => assignment.partidoId);
        let linkedIds = [];
        if (data.asignacionId) {
            await ownBatch(ligaId, data.asignacionId, actor);
            const links = await database_1.prisma.tandaArbitralPartido.findMany({ where: { tandaId: data.asignacionId }, select: { partidoId: true } });
            linkedIds = links.map((link) => link.partidoId);
            const linked = new Set(linkedIds);
            if (partidoIds.some((id) => !linked.has(id)))
                throw new errors_1.ValidationError('Solo se pueden editar partidos de la asignación indicada');
        }
        else {
            await ownLeague(ligaId, actor);
        }
        const conflictExclusions = linkedIds.length ? linkedIds : partidoIds;
        const refereeIds = [...new Set(data.asignaciones.flatMap((assignment) => assignment.arbitroIds))];
        const [divisions, referees, existingAssignments] = await Promise.all([
            database_1.prisma.division.findMany({
                where: { ligaId, id: { in: data.divisionIds } },
                select: {
                    id: true,
                    jornadas: { select: { partidos: { select: { id: true, fecha: true, fechaFin: true } } } },
                    rondasPlayoff: { select: { partidos: { select: { id: true, fecha: true, fechaFin: true } } } },
                },
            }),
            activeReferees(ligaId, refereeIds),
            database_1.prisma.partidoArbitro.findMany({
                where: {
                    arbitroId: { in: refereeIds },
                    ...(conflictExclusions.length ? { partidoId: { notIn: conflictExclusions } } : {}),
                    partido: { OR: [{ jornada: { division: { ligaId } } }, { rondaPlayoff: { division: { ligaId } } }] },
                },
                select: { arbitroId: true, partido: { select: { fecha: true, fechaFin: true } } },
            }),
        ]);
        const normalized = divisions.map((division) => ({
            id: division.id,
            partidos: [...division.jornadas.flatMap((jornada) => jornada.partidos), ...division.rondasPlayoff.flatMap((ronda) => ronda.partidos)],
        }));
        const existing = existingAssignments.map((row) => ({ arbitroId: row.arbitroId, fecha: row.partido.fecha, fechaFin: row.partido.fechaFin }));
        const rows = planLeagueAssignments(data.divisionIds, data.asignaciones, normalized, referees.map((referee) => referee.id), existing);
        let asignacionId = data.asignacionId;
        try {
            await database_1.prisma.$transaction(async (tx) => {
                if (!asignacionId) {
                    const alreadyLinked = await tx.tandaArbitralPartido.findMany({ where: { partidoId: { in: partidoIds } }, select: { partidoId: true } });
                    if (alreadyLinked.length)
                        throw new errors_1.ConflictError('Uno o más partidos ya pertenecen a una asignación arbitral');
                    const now = new Date();
                    const pad = (value) => String(value).padStart(2, '0');
                    const nombre = `Asignación ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())} (${crypto.randomUUID().slice(0, 8)})`;
                    const tanda = await tx.tandaArbitral.create({ data: { ligaId, nombre } });
                    asignacionId = tanda.id;
                    if (partidoIds.length)
                        await tx.tandaArbitralPartido.createMany({ data: partidoIds.map((partidoId) => ({ tandaId: tanda.id, partidoId })) });
                }
                await tx.partidoArbitro.deleteMany({ where: { partidoId: { in: partidoIds } } });
                if (rows.length)
                    await tx.partidoArbitro.createMany({ data: rows });
            });
        }
        catch (error) {
            if (error?.code === 'P2002')
                throw new errors_1.ConflictError('Uno o más partidos ya pertenecen a una asignación arbitral');
            throw error;
        }
        return { asignacionId: asignacionId, partidosAsignados: data.asignaciones.filter((assignment) => assignment.arbitroIds.length > 0).length, asignacionesCreadas: rows.length };
    },
};
//# sourceMappingURL=service.js.map