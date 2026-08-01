"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partidoService = void 0;
exports.findDeterministicMatching = findDeterministicMatching;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
const authorization_1 = require("../../utils/authorization");
const repository_1 = require("./repository");
const service_1 = require("../tabla-posicion/service");
const service_2 = require("../ronda-playoff/service");
const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
async function assertParentOwner(jornadaId, rondaPlayoffId, actor) {
    const parent = jornadaId
        ? await database_1.prisma.jornada.findUnique({ where: { id: jornadaId }, select: { division: { select: { liga: { select: { userId: true } } } } } })
        : rondaPlayoffId
            ? await database_1.prisma.rondaPlayoff.findUnique({ where: { id: rondaPlayoffId }, select: { division: { select: { liga: { select: { userId: true } } } } } })
            : null;
    if (!parent)
        throw new errors_1.NotFoundError(jornadaId ? 'Jornada' : rondaPlayoffId ? 'Ronda playoff' : 'Partido');
    (0, authorization_1.assertOwnerOrAdmin)(actor, parent.division.liga.userId, 'Partido');
}
function findDeterministicMatching(teamIds, occurrences) {
    const sorted = [...teamIds].sort((a, b) => a.localeCompare(b));
    if (sorted.length % 2 !== 0 || new Set(sorted).size !== sorted.length)
        return null;
    if (sorted.length === 0)
        return [];
    const normalize = (pairs) => pairs
        .map(([a, b]) => a < b ? [a, b] : [b, a])
        .sort((a, b) => pairKey(a[0], a[1]).localeCompare(pairKey(b[0], b[1])));
    const score = (pairs) => {
        const normalized = normalize(pairs);
        const frequencies = normalized.map(([a, b]) => occurrences.get(pairKey(a, b)) ?? 0);
        return {
            pairs: normalized,
            total: frequencies.reduce((sum, frequency) => sum + frequency, 0),
            // After aggregate frequency, minimize the most-repeated selected pair first.
            frequencies: frequencies.sort((a, b) => b - a),
            signature: normalized.map(([a, b]) => pairKey(a, b)).join(','),
        };
    };
    const compare = (a, b) => {
        if (a.total !== b.total)
            return a.total - b.total;
        for (let i = 0; i < a.frequencies.length; i++) {
            if (a.frequencies[i] !== b.frequencies[i])
                return a.frequencies[i] - b.frequencies[i];
        }
        return a.signature.localeCompare(b.signature);
    };
    // Circle rounds provide n - 1 deterministic perfect matchings and cover every possible pair once.
    let rotation = [...sorted];
    let best = null;
    for (let round = 0; round < sorted.length - 1; round++) {
        const pairs = [];
        for (let i = 0; i < rotation.length / 2; i++) {
            pairs.push([rotation[i], rotation[rotation.length - 1 - i]]);
        }
        const candidate = score(pairs);
        if (!best || compare(candidate, best) < 0)
            best = candidate;
        rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
    }
    // Deterministic best-improvement 2-opt broadens the circle candidates with a polynomial bound.
    for (let step = 0; step < sorted.length * sorted.length; step++) {
        let improved = best;
        for (let i = 0; i < best.pairs.length; i++) {
            for (let j = i + 1; j < best.pairs.length; j++) {
                const [a, b] = best.pairs[i];
                const [c, d] = best.pairs[j];
                for (const replacements of [[[a, c], [b, d]], [[a, d], [b, c]]]) {
                    const pairs = best.pairs.filter((_, index) => index !== i && index !== j).concat(replacements);
                    const candidate = score(pairs);
                    if (compare(candidate, improved) < 0)
                        improved = candidate;
                }
            }
        }
        if (improved === best)
            break;
        best = improved;
    }
    return best.pairs;
}
exports.partidoService = {
    async list(actor) {
        return repository_1.partidoRepository.findAllVisible(actor);
    },
    async getById(id, actor) {
        const t = await repository_1.partidoRepository.findVisibleById(id, actor);
        if (!t)
            throw new errors_1.NotFoundError('Partido');
        return t;
    },
    async findByJornada(jornadaId, actor) {
        const partidos = await repository_1.partidoRepository.findVisibleByJornada(jornadaId, actor);
        if (!partidos)
            throw new errors_1.NotFoundError('Jornada');
        return partidos;
    },
    async findByRondaPlayoff(rondaPlayoffId, actor) {
        const partidos = await repository_1.partidoRepository.findVisibleByRondaPlayoff(rondaPlayoffId, actor);
        if (!partidos)
            throw new errors_1.NotFoundError('Ronda playoff');
        return partidos;
    },
    async create(data, actor) {
        await assertParentOwner(data.jornadaId, data.rondaPlayoffId, actor);
        const partido = await repository_1.partidoRepository.create(data);
        if (data.estado === 'FINALIZADO' && data.jornadaId) {
            await this._recalcularDivision(data.jornadaId);
        }
        return partido;
    },
    async update(id, data, actor) {
        const ctx = await repository_1.partidoRepository.findAuthorizationContext(id);
        if (!ctx)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, ctx.ligaUserId, 'Partido');
        if (data.jornadaId !== undefined || data.rondaPlayoffId !== undefined) {
            await assertParentOwner(data.jornadaId, data.rondaPlayoffId, actor);
        }
        if (ctx.estado === 'FINALIZADO') {
            const allowedTargets = ctx.rondaPlayoffId ? ['SUSPENDIDO'] : ['SUSPENDIDO', 'PROGRAMADO'];
            if (!allowedTargets.includes(data.estado)) {
                throw new errors_1.ValidationError('No se puede modificar un partido ya finalizado');
            }
        }
        const replacesLocal = data.equipoLocalId !== undefined;
        const replacesVisitor = data.equipoVisitanteId !== undefined;
        if (replacesLocal || replacesVisitor) {
            if (replacesLocal && replacesVisitor) {
                throw new errors_1.ValidationError('Solo se puede intercambiar un equipo por solicitud');
            }
            if (ctx.estado !== 'PROGRAMADO') {
                throw new errors_1.ValidationError('Solo se pueden reemplazar equipos en partidos programados');
            }
            if (!ctx.jornadaId || ctx.rondaPlayoffId || !ctx.divisionId || ctx.tipoPartido !== 'REGULAR') {
                throw new errors_1.ValidationError('Solo se pueden reemplazar equipos en partidos regulares de jornada');
            }
            const incomingId = (replacesLocal ? data.equipoLocalId : data.equipoVisitanteId);
            const outgoingId = replacesLocal ? ctx.equipoLocalId : ctx.equipoVisitanteId;
            if (!incomingId || !outgoingId) {
                throw new errors_1.ValidationError('Los equipos del intercambio son obligatorios');
            }
            const equipoLocalId = replacesLocal ? incomingId : ctx.equipoLocalId;
            const equipoVisitanteId = replacesVisitor ? incomingId : ctx.equipoVisitanteId;
            if (equipoLocalId === equipoVisitanteId) {
                throw new errors_1.ValidationError('El equipo local y visitante deben ser diferentes');
            }
            const linkedTeams = await database_1.prisma.divisionEquipo.count({
                where: { divisionId: ctx.divisionId, equipoId: incomingId },
            });
            if (linkedTeams !== 1) {
                throw new errors_1.ValidationError('El equipo de reemplazo no pertenece a la división de la jornada');
            }
            const targets = await database_1.prisma.partido.findMany({
                where: {
                    id: { not: id },
                    jornadaId: ctx.jornadaId,
                    rondaPlayoffId: null,
                    tipoPartido: 'REGULAR',
                    OR: [{ equipoLocalId: incomingId }, { equipoVisitanteId: incomingId }],
                },
                select: {
                    id: true, estado: true, fecha: true, fechaFin: true,
                    equipoLocalId: true, equipoVisitanteId: true,
                },
            });
            if (targets.length === 0) {
                throw new errors_1.ValidationError('El equipo seleccionado no tiene otro partido en esta jornada para intercambiar');
            }
            if (targets.length > 1) {
                throw new errors_1.ValidationError('El equipo seleccionado aparece en varios partidos de esta jornada; el intercambio es ambiguo');
            }
            const target = targets[0];
            if (target.estado !== 'PROGRAMADO') {
                throw new errors_1.ValidationError('El partido del equipo seleccionado debe estar programado');
            }
            const targetLocalId = target.equipoLocalId === incomingId ? outgoingId : target.equipoLocalId;
            const targetVisitorId = target.equipoVisitanteId === incomingId ? outgoingId : target.equipoVisitanteId;
            if (targetLocalId === targetVisitorId) {
                throw new errors_1.ValidationError('El intercambio produciría un partido con el mismo equipo como local y visitante');
            }
            const intervals = [
                { teamId: incomingId, start: data.fecha !== undefined ? new Date(data.fecha) : ctx.fecha, end: data.fechaFin !== undefined ? new Date(data.fechaFin) : ctx.fechaFin },
                { teamId: outgoingId, start: target.fecha, end: target.fechaFin },
            ].filter((interval) => Boolean(interval.start && interval.end));
            if (intervals.length > 0) {
                const conflict = await database_1.prisma.partido.findFirst({
                    where: {
                        id: { notIn: [id, target.id] },
                        AND: [
                            {
                                OR: [
                                    { jornada: { divisionId: ctx.divisionId } },
                                    { rondaPlayoff: { divisionId: ctx.divisionId } },
                                ],
                            },
                            {
                                OR: intervals.map((interval) => ({
                                    fecha: { lt: interval.end },
                                    fechaFin: { gt: interval.start },
                                    OR: [
                                        { equipoLocalId: interval.teamId },
                                        { equipoVisitanteId: interval.teamId },
                                    ],
                                })),
                            },
                        ],
                    },
                    select: { id: true },
                });
                if (conflict) {
                    throw new errors_1.ValidationError('Uno de los equipos ya tiene un partido en el horario resultante');
                }
            }
            const targetData = target.equipoLocalId === incomingId
                ? { equipoLocalId: outgoingId }
                : { equipoVisitanteId: outgoingId };
            return database_1.prisma.$transaction(async (tx) => {
                const jornadas = await tx.jornada.findMany({
                    where: { divisionId: ctx.divisionId },
                    orderBy: { numero: 'asc' },
                    select: {
                        id: true,
                        numero: true,
                        partidos: {
                            where: { rondaPlayoffId: null, tipoPartido: 'REGULAR' },
                            select: { id: true, estado: true, fecha: true, equipoLocalId: true, equipoVisitanteId: true },
                        },
                    },
                });
                const currentJornada = jornadas.find((jornada) => jornada.id === ctx.jornadaId);
                if (!currentJornada)
                    throw new errors_1.ValidationError('La jornada del partido ya no está disponible');
                const future = jornadas.filter((jornada) => jornada.numero > currentJornada.numero);
                if (future.some((jornada) => jornada.partidos.some((partido) => partido.estado !== 'PROGRAMADO'))) {
                    throw new errors_1.ValidationError('No se puede recalcular: todos los partidos regulares de jornadas posteriores deben estar programados');
                }
                const occurrences = new Map();
                for (const jornada of jornadas) {
                    if (jornada.numero >= currentJornada.numero)
                        continue;
                    for (const partido of jornada.partidos) {
                        if (partido.equipoLocalId && partido.equipoVisitanteId) {
                            const key = pairKey(partido.equipoLocalId, partido.equipoVisitanteId);
                            occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
                        }
                    }
                }
                const transactionalCurrent = currentJornada.partidos.find((partido) => partido.id === id);
                const transactionalTarget = currentJornada.partidos.find((partido) => partido.id === target.id);
                if (transactionalCurrent?.estado !== 'PROGRAMADO' || transactionalTarget?.estado !== 'PROGRAMADO') {
                    throw new errors_1.ValidationError('Los partidos del intercambio deben continuar programados');
                }
                if (transactionalCurrent.equipoLocalId !== ctx.equipoLocalId
                    || transactionalCurrent.equipoVisitanteId !== ctx.equipoVisitanteId
                    || transactionalTarget.equipoLocalId !== target.equipoLocalId
                    || transactionalTarget.equipoVisitanteId !== target.equipoVisitanteId) {
                    throw new errors_1.ValidationError('Los participantes de los partidos del intercambio cambiaron; vuelve a intentarlo');
                }
                const currentPairs = new Set();
                for (const partido of currentJornada.partidos) {
                    let local = partido.equipoLocalId;
                    let visitante = partido.equipoVisitanteId;
                    if (partido.id === id)
                        local = replacesLocal ? incomingId : local, visitante = replacesVisitor ? incomingId : visitante;
                    if (partido.id === target.id)
                        local = targetData.equipoLocalId ?? local, visitante = targetData.equipoVisitanteId ?? visitante;
                    if (!local || !visitante || local === visitante)
                        throw new errors_1.ValidationError('La jornada actual contiene partidos regulares incompletos o inválidos');
                    const key = pairKey(local, visitante);
                    if (currentPairs.has(key))
                        throw new errors_1.ValidationError('El intercambio produciría un enfrentamiento duplicado dentro de la jornada actual');
                    currentPairs.add(key);
                    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
                }
                const recalculated = [];
                for (const jornada of future) {
                    const slots = [...jornada.partidos].sort((a, b) => {
                        const dateOrder = (a.fecha?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.fecha?.getTime() ?? Number.MAX_SAFE_INTEGER);
                        return dateOrder || a.id.localeCompare(b.id);
                    });
                    const teams = slots.flatMap((partido) => [partido.equipoLocalId, partido.equipoVisitanteId]).filter((team) => Boolean(team));
                    if (teams.length !== slots.length * 2 || new Set(teams).size !== teams.length) {
                        throw new errors_1.ValidationError(`La jornada ${jornada.numero} tiene participantes regulares incompletos o duplicados`);
                    }
                    const pairs = findDeterministicMatching(teams, occurrences);
                    if (!pairs)
                        throw new errors_1.ValidationError(`No existe una combinación válida para la jornada ${jornada.numero}`);
                    for (const [local, visitante] of pairs) {
                        const key = pairKey(local, visitante);
                        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
                    }
                    recalculated.push({ slots, pairs });
                }
                const scheduleWrites = [
                    tx.partido.update({ where: { id: target.id }, data: targetData }),
                    ...recalculated.flatMap((jornada) => jornada.slots.map((slot, index) => tx.partido.update({
                        where: { id: slot.id },
                        data: { equipoLocalId: jornada.pairs[index][0], equipoVisitanteId: jornada.pairs[index][1] },
                    }))),
                ];
                const [, updated] = await Promise.all([
                    Promise.all(scheduleWrites),
                    tx.partido.update({
                        where: { id }, data,
                        include: {
                            equipoLocal: { select: { id: true, nombre: true, logo: true } },
                            equipoVisitante: { select: { id: true, nombre: true, logo: true } },
                            cancha: { select: { id: true, nombre: true } },
                            arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
                        },
                    }),
                ]);
                return { ...updated, arbitros: updated.arbitros?.map((row) => row.arbitro), jornadasRecalculadas: recalculated.length };
            });
        }
        return this._applyResult(id, data, ctx);
    },
    async _applyResult(id, data, ctx) {
        if (data.estado === 'FINALIZADO' && ctx.rondaPlayoffId) {
            const golesLocal = (data.golesLocal ?? ctx.golesLocal);
            const golesVisitante = (data.golesVisitante ?? ctx.golesVisitante);
            const penalesLocal = data.penalesLocal !== undefined ? data.penalesLocal : ctx.penalesLocal;
            const penalesVisitante = data.penalesVisitante !== undefined ? data.penalesVisitante : ctx.penalesVisitante;
            if (golesLocal === golesVisitante) {
                if (penalesLocal == null || penalesVisitante == null || penalesLocal === penalesVisitante) {
                    throw new errors_1.ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.');
                }
            }
        }
        const oldEstado = ctx.estado;
        if (oldEstado === 'FINALIZADO' && data.estado === 'PROGRAMADO') {
            data.golesLocal = 0;
            data.golesVisitante = 0;
            data.penalesLocal = null;
            data.penalesVisitante = null;
        }
        const partido = await repository_1.partidoRepository.update(id, data);
        const wasFinalizado = oldEstado === 'FINALIZADO';
        const nowFinalizado = partido.estado === 'FINALIZADO';
        if ((nowFinalizado || wasFinalizado) && partido.jornadaId) {
            await this._recalcularDivision(partido.jornadaId);
        }
        if (nowFinalizado && partido.rondaPlayoffId) {
            await service_2.rondaPlayoffService.advanceWinners(partido.rondaPlayoffId);
        }
        return partido;
    },
    async delete(id, actor) {
        const ctx = await repository_1.partidoRepository.findAuthorizationContext(id);
        if (!ctx)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, ctx.ligaUserId, 'Partido');
        await repository_1.partidoRepository.delete(id);
        if (ctx.estado === 'FINALIZADO' && ctx.jornadaId) {
            await this._recalcularDivision(ctx.jornadaId);
        }
    },
    async _recalcularDivision(jornadaId) {
        const jornada = await database_1.prisma.jornada.findUnique({ where: { id: jornadaId }, select: { divisionId: true } });
        if (jornada) {
            await service_1.tablaPosicionService.recalcular(jornada.divisionId);
        }
    },
};
//# sourceMappingURL=service.js.map