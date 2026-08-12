"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rondaPlayoffService = void 0;
const errors_1 = require("../../utils/errors");
const database_1 = require("../../config/database");
const repository_1 = require("./repository");
const authorization_1 = require("../../utils/authorization");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
const leagueScheduleLock_1 = require("../../utils/leagueScheduleLock");
async function assertDivisionOwner(divisionId, actor) {
    const division = await database_1.prisma.division.findUnique({
        where: { id: divisionId },
        select: { liga: { select: { userId: true } } },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
    (0, authorization_1.assertOwnerOrAdmin)(actor, division.liga.userId, 'División');
}
async function findForWrite(id, actor) {
    const ronda = await repository_1.rondaPlayoffRepository.findById(id);
    if (!ronda)
        throw new errors_1.NotFoundError('Ronda de playoff');
    await (0, divisionVisibility_1.assertVisibleDivision)(ronda.divisionId, actor);
    return ronda;
}
function getWinner(p) {
    if (p.golesLocal > p.golesVisitante)
        return p.equipoLocalId;
    if (p.golesVisitante > p.golesLocal)
        return p.equipoVisitanteId;
    if (p.penalesLocal != null && p.penalesVisitante != null) {
        if (p.penalesLocal > p.penalesVisitante)
            return p.equipoLocalId;
        if (p.penalesVisitante > p.penalesLocal)
            return p.equipoVisitanteId;
    }
    return null;
}
const NOMBRES_RONDAS = {
    2: ['Final'],
    4: ['Semifinal', 'Final'],
    8: ['Cuartos', 'Semifinal', 'Final'],
    16: ['Octavos', 'Cuartos', 'Semifinal', 'Final'],
    32: ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'],
};
const CANTIDADES_EQUIPOS = [2, 4, 8, 16, 32];
const spanishNameCollator = new Intl.Collator('es', { sensitivity: 'base' });
async function serializablePlayoffWrite(operation, conflictMessage) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await database_1.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
        }
        catch (error) {
            if (error?.code === 'P2034' && attempt < 2)
                continue;
            if (error?.code === 'P2034' || error?.code === 'P2002')
                throw new errors_1.ConflictError(conflictMessage);
            throw error;
        }
    }
    throw new errors_1.ConflictError(conflictMessage);
}
async function lockedDivision(tx, divisionId, actor) {
    const lockTarget = await tx.division.findUnique({ where: { id: divisionId }, select: { ligaId: true } });
    if (!lockTarget)
        throw new errors_1.NotFoundError('División');
    await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, lockTarget.ligaId);
    const division = await tx.division.findUnique({
        where: { id: divisionId },
        select: { ligaId: true, liga: { select: { userId: true } } },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
    if (division.ligaId !== lockTarget.ligaId)
        throw new errors_1.ConflictError('La división cambió de liga durante la operación; vuelve a intentarlo');
    (0, authorization_1.assertOwnerOrAdmin)(actor, division.liga.userId, 'División');
    return division;
}
exports.rondaPlayoffService = {
    async list(pagination, actor) {
        const where = { division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) };
        const [rows, total] = await Promise.all([
            database_1.prisma.rondaPlayoff.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
            database_1.prisma.rondaPlayoff.count({ where }),
        ]);
        return { rows, total };
    },
    async getById(id, actor) {
        const t = await repository_1.rondaPlayoffRepository.findVisibleById(id, actor);
        if (!t)
            throw new errors_1.NotFoundError('Ronda de playoff');
        return t;
    },
    async findByDivision(divisionId, actor) {
        const rondas = await repository_1.rondaPlayoffRepository.findVisibleByDivision(divisionId, actor);
        if (!rondas)
            throw new errors_1.NotFoundError('División');
        return rondas;
    },
    async create(data, actor) {
        await assertDivisionOwner(data.divisionId, actor);
        return repository_1.rondaPlayoffRepository.create(data);
    },
    async update(id, data, actor) {
        const ronda = await findForWrite(id, actor);
        await assertDivisionOwner(ronda.divisionId, actor);
        return repository_1.rondaPlayoffRepository.update(id, data);
    },
    async delete(id, actor) {
        await serializablePlayoffWrite(async (tx) => {
            const lockTarget = await tx.rondaPlayoff.findUnique({
                where: { id },
                select: { divisionId: true, division: { select: { ligaId: true } } },
            });
            if (!lockTarget)
                throw new errors_1.NotFoundError('Ronda de playoff');
            await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, lockTarget.division.ligaId);
            const ronda = await tx.rondaPlayoff.findUnique({
                where: { id },
                select: { orden: true, division: { select: { ligaId: true, liga: { select: { userId: true } }, rondasPlayoff: { orderBy: { orden: 'desc' }, take: 1, select: { id: true } } } } },
            });
            if (!ronda)
                throw new errors_1.NotFoundError('Ronda de playoff');
            if (ronda.division.ligaId !== lockTarget.division.ligaId)
                throw new errors_1.ConflictError('La ronda cambió de liga durante la eliminación; vuelve a intentarlo');
            (0, authorization_1.assertOwnerOrAdmin)(actor, ronda.division.liga.userId, 'División');
            if (ronda.division.rondasPlayoff[0]?.id !== id) {
                throw new errors_1.ConflictError('Solo se puede eliminar la última ronda de playoff');
            }
            await tx.rondaPlayoff.delete({ where: { id } });
        }, 'Las rondas de playoff cambiaron durante la eliminación; vuelve a intentarlo');
    },
    async deleteByDivision(divisionId, actor) {
        await serializablePlayoffWrite(async (tx) => {
            await lockedDivision(tx, divisionId, actor);
            await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
        }, 'Las rondas de playoff cambiaron durante la eliminación; vuelve a intentarlo');
    },
    async generate(divisionId, cantidadEquipos, actor) {
        if (!CANTIDADES_EQUIPOS.includes(cantidadEquipos)) {
            throw new errors_1.ValidationError('La cantidad debe ser 2, 4, 8, 16 o 32');
        }
        return serializablePlayoffWrite(async (tx) => {
            const lockTarget = await tx.division.findUnique({ where: { id: divisionId }, select: { ligaId: true } });
            if (!lockTarget)
                throw new errors_1.NotFoundError('División');
            await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, lockTarget.ligaId);
            const division = await tx.division.findFirst({
                where: (0, authorization_1.isAdmin)(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
                select: {
                    ligaId: true,
                    rondasPlayoff: { take: 1, select: { id: true } },
                    equipos: {
                        select: {
                            equipoId: true,
                            equipo: {
                                select: {
                                    nombre: true,
                                    tablaPosiciones: {
                                        where: { divisionId },
                                        select: { puntos: true, diferenciaGoles: true, ganados: true, golesFavor: true },
                                    },
                                },
                            },
                        },
                    },
                },
            });
            if (!division)
                throw new errors_1.NotFoundError('División');
            if (division.ligaId !== lockTarget.ligaId)
                throw new errors_1.ConflictError('La división cambió de liga durante la generación; vuelve a intentarlo');
            if (division.rondasPlayoff.length > 0)
                throw new errors_1.ConflictError('La división ya tiene rondas de playoff');
            if (division.equipos.length < cantidadEquipos) {
                throw new errors_1.ValidationError(`Se necesitan al menos ${cantidadEquipos} equipos asignados a la división`);
            }
            const clasificados = division.equipos
                .map(({ equipoId, equipo }) => ({
                equipoId,
                nombre: equipo.nombre,
                puntos: equipo.tablaPosiciones[0]?.puntos ?? 0,
                diferenciaGoles: equipo.tablaPosiciones[0]?.diferenciaGoles ?? 0,
                ganados: equipo.tablaPosiciones[0]?.ganados ?? 0,
                golesFavor: equipo.tablaPosiciones[0]?.golesFavor ?? 0,
            }))
                .sort((a, b) => b.puntos - a.puntos
                || b.diferenciaGoles - a.diferenciaGoles
                || b.ganados - a.ganados
                || b.golesFavor - a.golesFavor
                || spanishNameCollator.compare(a.nombre, b.nombre)
                || a.equipoId.localeCompare(b.equipoId))
                .slice(0, cantidadEquipos);
            const rondas = await tx.rondaPlayoff.createManyAndReturn({
                data: NOMBRES_RONDAS[cantidadEquipos].map((nombre, index) => ({ nombre, orden: index + 1, divisionId })),
            });
            rondas.sort((a, b) => a.orden - b.orden);
            const primeraRonda = rondas[0];
            await tx.partido.createMany({ data: Array.from({ length: clasificados.length / 2 }, (_, i) => ({
                    equipoLocalId: clasificados[i].equipoId,
                    equipoVisitanteId: clasificados[clasificados.length - 1 - i].equipoId,
                    llave: i + 1,
                    rondaPlayoffId: primeraRonda.id,
                    estado: 'PROGRAMADO',
                    tipoPartido: 'ELIMINATORIA',
                })) });
            return rondas;
        }, 'Las rondas de playoff ya existen o fueron generadas concurrentemente');
    },
    async syncAdvancement(tx, fromRondaPlayoffId) {
        const currentRound = await tx.rondaPlayoff.findUnique({
            where: { id: fromRondaPlayoffId },
            select: {
                orden: true,
                division: { select: { rondasPlayoff: { select: { id: true, orden: true } } } },
            },
        });
        if (!currentRound)
            throw new errors_1.NotFoundError('Ronda de playoff');
        const nextRound = currentRound.division.rondasPlayoff.find((ronda) => ronda.orden === currentRound.orden + 1);
        if (!nextRound)
            return;
        const partidos = await tx.partido.findMany({
            where: { rondaPlayoffId: { in: [fromRondaPlayoffId, nextRound.id] } },
            select: {
                id: true,
                rondaPlayoffId: true,
                llave: true,
                estado: true,
                golesLocal: true,
                golesVisitante: true,
                penalesLocal: true,
                penalesVisitante: true,
                equipoLocalId: true,
                equipoVisitanteId: true,
                jornadaId: true,
            },
        });
        const currentRoundPartidos = partidos.filter((partido) => partido.rondaPlayoffId === fromRondaPlayoffId);
        const currentPartidos = new Map(currentRoundPartidos.map((partido) => [partido.llave, partido]));
        const nextPartidos = new Map(partidos
            .filter((partido) => partido.rondaPlayoffId === nextRound.id)
            .map((partido) => [partido.llave, partido]));
        const highestSourceKey = Math.max(0, ...currentRoundPartidos.map((partido) => partido.llave ?? 0));
        const highestDerivedKey = Math.max(0, ...Array.from(nextPartidos.keys()).filter((llave) => llave != null));
        const pairCount = Math.max(Math.ceil(highestSourceKey / 2), highestDerivedKey);
        for (let i = 1; i <= pairCount; i++) {
            const partidoA = currentPartidos.get(i * 2 - 1);
            const partidoB = currentPartidos.get(i * 2);
            const existing = nextPartidos.get(i);
            const winnerA = partidoA?.estado === 'FINALIZADO' ? getWinner(partidoA) : null;
            const winnerB = partidoB?.estado === 'FINALIZADO' ? getWinner(partidoB) : null;
            if (!winnerA || !winnerB) {
                if (!existing)
                    continue;
                if (existing.estado === 'FINALIZADO' || existing.jornadaId) {
                    throw new errors_1.ConflictError('No se puede revertir el avance porque el partido derivado ya está finalizado o asignado a una jornada');
                }
                await tx.partido.delete({ where: { id: existing.id } });
                continue;
            }
            if (existing) {
                if (existing.equipoLocalId === winnerA && existing.equipoVisitanteId === winnerB)
                    continue;
                if (existing.estado === 'FINALIZADO' || existing.jornadaId) {
                    throw new errors_1.ConflictError('No se puede cambiar el avance porque el partido derivado ya está finalizado o asignado a una jornada');
                }
                await tx.partido.update({
                    where: { id: existing.id },
                    data: { equipoLocalId: winnerA, equipoVisitanteId: winnerB, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null, version: { increment: 1 } },
                });
                await tx.anotacionPartido.deleteMany({ where: { partidoId: existing.id } });
                await tx.participacionPartido.deleteMany({ where: { partidoId: existing.id } });
            }
            else {
                await tx.partido.create({ data: {
                        equipoLocalId: winnerA,
                        equipoVisitanteId: winnerB,
                        llave: i,
                        rondaPlayoffId: nextRound.id,
                        estado: 'PROGRAMADO',
                        tipoPartido: 'ELIMINATORIA',
                    } });
            }
        }
    },
    async advanceWinners(fromRondaPlayoffId) {
        await serializablePlayoffWrite(async (tx) => {
            const lockTarget = await tx.rondaPlayoff.findUnique({ where: { id: fromRondaPlayoffId }, select: { division: { select: { ligaId: true } } } });
            if (!lockTarget)
                throw new errors_1.NotFoundError('Ronda de playoff');
            await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, lockTarget.division.ligaId);
            await this.syncAdvancement(tx, fromRondaPlayoffId);
        }, 'El cuadro de playoff cambió durante el avance; vuelve a intentarlo');
    },
};
//# sourceMappingURL=service.js.map