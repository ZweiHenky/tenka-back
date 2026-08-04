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
const leagueScheduleLock_1 = require("../../utils/leagueScheduleLock");
const playoffFinalization_1 = require("./playoffFinalization");
const resultWriter_1 = require("./resultWriter");
const scheduleChangeOutbox_1 = require("../notification/scheduleChangeOutbox");
const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
class StaleReplacementPlanError extends Error {
}
const REPLACEMENT_INCOMPATIBLE_FIELDS = new Set([
    'golesLocal', 'golesVisitante', 'penalesLocal', 'penalesVisitante', 'estado',
    'jornadaId', 'rondaPlayoffId', 'tipoPartido',
]);
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
        const replacesLocal = data.equipoLocalId !== undefined;
        const replacesVisitor = data.equipoVisitanteId !== undefined;
        if (replacesLocal || replacesVisitor) {
            if (replacesLocal && replacesVisitor) {
                throw new errors_1.ValidationError('Solo se puede intercambiar un equipo por solicitud');
            }
            if (Object.keys(data).some((field) => REPLACEMENT_INCOMPATIBLE_FIELDS.has(field))) {
                throw new errors_1.ValidationError('No se puede combinar el reemplazo de equipo con cambios de resultado, estado, tipo o jornada');
            }
            const incomingId = (replacesLocal ? data.equipoLocalId : data.equipoVisitanteId);
            if (!incomingId)
                throw new errors_1.ValidationError('Los equipos del intercambio son obligatorios');
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    return await database_1.prisma.$transaction(async (tx) => {
                        await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ctx.ligaId);
                        const lockedCtx = await repository_1.partidoRepository.findAuthorizationContext(id, tx);
                        if (!lockedCtx)
                            throw new errors_1.NotFoundError('Partido');
                        (0, authorization_1.assertOwnerOrAdmin)(actor, lockedCtx.ligaUserId, 'Partido');
                        if (lockedCtx.ligaId !== ctx.ligaId)
                            throw new StaleReplacementPlanError();
                        if (lockedCtx.estado !== 'PROGRAMADO') {
                            throw new errors_1.ValidationError('Solo se pueden reemplazar equipos en partidos programados');
                        }
                        if (!lockedCtx.jornadaId || lockedCtx.rondaPlayoffId || !lockedCtx.divisionId || lockedCtx.tipoPartido !== 'REGULAR') {
                            throw new errors_1.ValidationError('Solo se pueden reemplazar equipos en partidos regulares de jornada');
                        }
                        const linkedTeams = await tx.divisionEquipo.count({
                            where: { divisionId: lockedCtx.divisionId, equipoId: incomingId },
                        });
                        if (linkedTeams !== 1) {
                            throw new errors_1.ValidationError('El equipo de reemplazo no pertenece a la división de la jornada');
                        }
                        const jornadas = await tx.jornada.findMany({
                            where: { divisionId: lockedCtx.divisionId },
                            orderBy: { numero: 'asc' },
                            select: {
                                id: true,
                                numero: true,
                                partidos: {
                                    where: { rondaPlayoffId: null, tipoPartido: 'REGULAR' },
                                    select: { id: true, estado: true, fecha: true, fechaFin: true, equipoLocalId: true, equipoVisitanteId: true },
                                },
                            },
                        });
                        const currentJornada = jornadas.find((jornada) => jornada.id === lockedCtx.jornadaId);
                        if (!currentJornada)
                            throw new errors_1.ValidationError('La jornada del partido ya no está disponible');
                        const current = currentJornada.partidos.find((partido) => partido.id === id);
                        if (!current)
                            throw new StaleReplacementPlanError();
                        if (current.estado !== 'PROGRAMADO') {
                            throw new errors_1.ValidationError('Solo se pueden reemplazar equipos en partidos programados');
                        }
                        const outgoingId = replacesLocal ? current.equipoLocalId : current.equipoVisitanteId;
                        if (!outgoingId)
                            throw new errors_1.ValidationError('Los equipos del intercambio son obligatorios');
                        const currentLocalId = replacesLocal ? incomingId : current.equipoLocalId;
                        const currentVisitorId = replacesVisitor ? incomingId : current.equipoVisitanteId;
                        if (currentLocalId === currentVisitorId) {
                            throw new errors_1.ValidationError('El equipo local y visitante deben ser diferentes');
                        }
                        const targets = currentJornada.partidos.filter((partido) => (partido.id !== id
                            && (partido.equipoLocalId === incomingId || partido.equipoVisitanteId === incomingId)));
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
                        const replacementStart = data.fecha !== undefined ? new Date(data.fecha) : current.fecha;
                        const replacementEnd = data.fechaFin !== undefined ? new Date(data.fechaFin) : current.fechaFin;
                        const intervals = [
                            { teamId: incomingId, start: replacementStart, end: replacementEnd },
                            { teamId: outgoingId, start: target.fecha, end: target.fechaFin },
                        ].filter((interval) => Boolean(interval.start && interval.end));
                        if (intervals.length > 0) {
                            const conflict = await tx.partido.findFirst({
                                where: {
                                    id: { notIn: [id, target.id] },
                                    AND: [
                                        { OR: [
                                                { jornada: { divisionId: lockedCtx.divisionId } },
                                                { rondaPlayoff: { divisionId: lockedCtx.divisionId } },
                                            ] },
                                        { OR: intervals.map((interval) => ({
                                                fecha: { lt: interval.end },
                                                fechaFin: { gt: interval.start },
                                                OR: [{ equipoLocalId: interval.teamId }, { equipoVisitanteId: interval.teamId }],
                                            })) },
                                    ],
                                },
                                select: { id: true },
                            });
                            if (conflict)
                                throw new errors_1.ValidationError('Uno de los equipos ya tiene un partido en el horario resultante');
                        }
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
                        const currentPairs = new Set();
                        for (const partido of currentJornada.partidos) {
                            const local = partido.id === id ? currentLocalId : partido.id === target.id ? targetLocalId : partido.equipoLocalId;
                            const visitor = partido.id === id ? currentVisitorId : partido.id === target.id ? targetVisitorId : partido.equipoVisitanteId;
                            if (!local || !visitor || local === visitor)
                                throw new errors_1.ValidationError('La jornada actual contiene partidos regulares incompletos o inválidos');
                            const key = pairKey(local, visitor);
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
                            for (const [local, visitor] of pairs) {
                                const key = pairKey(local, visitor);
                                occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
                            }
                            recalculated.push({ jornadaId: jornada.id, slots, pairs });
                        }
                        const writes = [
                            {
                                id,
                                jornadaId: currentJornada.id,
                                expected: current,
                                data: { ...data, equipoLocalId: currentLocalId, equipoVisitanteId: currentVisitorId },
                            },
                            {
                                id: target.id,
                                jornadaId: currentJornada.id,
                                expected: target,
                                data: { equipoLocalId: targetLocalId, equipoVisitanteId: targetVisitorId },
                            },
                            ...recalculated.flatMap((jornada) => jornada.slots.map((slot, index) => ({
                                id: slot.id,
                                jornadaId: jornada.jornadaId,
                                expected: slot,
                                data: { equipoLocalId: jornada.pairs[index][0], equipoVisitanteId: jornada.pairs[index][1] },
                            }))),
                        ].sort((a, b) => a.id.localeCompare(b.id));
                        for (const write of writes) {
                            const result = await tx.partido.updateMany({
                                where: {
                                    id: write.id,
                                    estado: write.expected.estado,
                                    jornadaId: write.jornadaId,
                                    rondaPlayoffId: null,
                                    tipoPartido: 'REGULAR',
                                    equipoLocalId: write.expected.equipoLocalId,
                                    equipoVisitanteId: write.expected.equipoVisitanteId,
                                },
                                data: write.data,
                            });
                            if (result.count !== 1)
                                throw new StaleReplacementPlanError();
                        }
                        await (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
                            divisionId: lockedCtx.divisionId,
                            ligaId: lockedCtx.ligaId,
                            changes: (0, scheduleChangeOutbox_1.collectScheduleChanges)(writes),
                        });
                        const updated = await tx.partido.findUnique({ where: { id }, include: repository_1.PARTIDO_READ_INCLUDE });
                        if (!updated)
                            throw new StaleReplacementPlanError();
                        return { ...(0, repository_1.exposePartidoRead)(updated), jornadasRecalculadas: recalculated.length };
                    }, { isolationLevel: 'Serializable' });
                }
                catch (error) {
                    const retryable = error instanceof StaleReplacementPlanError || error?.code === 'P2034';
                    if (retryable && attempt < 2)
                        continue;
                    if (retryable)
                        throw new errors_1.ConflictError('La programación cambió durante el intercambio; vuelve a intentarlo');
                    throw error;
                }
            }
            throw new errors_1.ConflictError('La programación cambió durante el intercambio; vuelve a intentarlo');
        }
        if (data.jornadaId !== undefined || data.rondaPlayoffId !== undefined) {
            await assertParentOwner(data.jornadaId, data.rondaPlayoffId, actor);
        }
        if (ctx.estado === 'FINALIZADO' && (!ctx.jornadaId || ctx.rondaPlayoffId)) {
            const allowedTargets = ctx.rondaPlayoffId ? ['SUSPENDIDO'] : ['SUSPENDIDO', 'PROGRAMADO'];
            if (!allowedTargets.includes(data.estado)) {
                throw new errors_1.ValidationError('No se puede modificar un partido ya finalizado');
            }
        }
        if (ctx.rondaPlayoffId) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    return await database_1.prisma.$transaction(async (tx) => {
                        await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ctx.ligaId);
                        const lockedCtx = await repository_1.partidoRepository.findAuthorizationContext(id, tx);
                        if (!lockedCtx)
                            throw new errors_1.NotFoundError('Partido');
                        (0, authorization_1.assertOwnerOrAdmin)(actor, lockedCtx.ligaUserId, 'Partido');
                        if (!lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
                            throw new errors_1.ConflictError('El partido cambió durante la actualización; vuelve a intentarlo');
                        }
                        if (lockedCtx.estado === 'FINALIZADO' && data.estado !== 'SUSPENDIDO') {
                            throw new errors_1.ValidationError('No se puede modificar un partido ya finalizado');
                        }
                        if (data.estado === 'FINALIZADO') {
                            const scheduleError = (0, playoffFinalization_1.validatePlayoffFinalizationSchedule)({
                                fecha: lockedCtx.fecha,
                                fechaFin: lockedCtx.fechaFin,
                                multiplesCanchas: lockedCtx.multiplesCanchas,
                                canchaId: lockedCtx.canchaId,
                            });
                            if (scheduleError)
                                throw new errors_1.ValidationError(scheduleError);
                            const golesLocal = (data.golesLocal ?? lockedCtx.golesLocal);
                            const golesVisitante = (data.golesVisitante ?? lockedCtx.golesVisitante);
                            const penalesLocal = data.penalesLocal !== undefined ? data.penalesLocal : lockedCtx.penalesLocal;
                            const penalesVisitante = data.penalesVisitante !== undefined ? data.penalesVisitante : lockedCtx.penalesVisitante;
                            if (golesLocal === golesVisitante && (penalesLocal == null || penalesVisitante == null || penalesLocal === penalesVisitante)) {
                                throw new errors_1.ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.');
                            }
                        }
                        const playoffData = data.estado === 'PROGRAMADO'
                            ? { ...data, golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null, version: { increment: 1 } }
                            : data.estado ? { ...data, version: { increment: 1 } } : data;
                        const partido = await repository_1.partidoRepository.update(id, playoffData, tx);
                        if (data.estado === 'PROGRAMADO')
                            await tx.anotacionPartido.deleteMany({ where: { partidoId: id } });
                        await service_2.rondaPlayoffService.syncAdvancement(tx, lockedCtx.rondaPlayoffId);
                        return partido;
                    }, { isolationLevel: 'Serializable' });
                }
                catch (error) {
                    if (error?.code === 'P2034' && attempt < 2)
                        continue;
                    if (error?.code === 'P2034')
                        throw new errors_1.ConflictError('El cuadro de playoff cambió durante la actualización; vuelve a intentarlo');
                    throw error;
                }
            }
            throw new errors_1.ConflictError('El cuadro de playoff cambió durante la actualización; vuelve a intentarlo');
        }
        if (ctx.jornadaId && !ctx.rondaPlayoffId) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    return await database_1.prisma.$transaction(async (tx) => {
                        await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ctx.ligaId);
                        const lockedCtx = await repository_1.partidoRepository.findAuthorizationContext(id, tx);
                        if (!lockedCtx)
                            throw new errors_1.NotFoundError('Partido');
                        (0, authorization_1.assertOwnerOrAdmin)(actor, lockedCtx.ligaUserId, 'Partido');
                        if (!lockedCtx.jornadaId || lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
                            throw new errors_1.ConflictError('El partido cambió durante la actualización; vuelve a intentarlo');
                        }
                        if (lockedCtx.estado === 'FINALIZADO') {
                            const allowedTargets = ['SUSPENDIDO', 'PROGRAMADO'];
                            if (!allowedTargets.includes(data.estado)) {
                                throw new errors_1.ValidationError('No se puede modificar un partido ya finalizado');
                            }
                        }
                        const transactionalData = { ...data };
                        if (transactionalData.estado === 'PROGRAMADO') {
                            transactionalData.golesLocal = 0;
                            transactionalData.golesVisitante = 0;
                            transactionalData.penalesLocal = null;
                            transactionalData.penalesVisitante = null;
                        }
                        if (transactionalData.estado)
                            transactionalData.version = { increment: 1 };
                        const partido = await repository_1.partidoRepository.update(id, transactionalData, tx);
                        if (transactionalData.estado === 'PROGRAMADO')
                            await tx.anotacionPartido.deleteMany({ where: { partidoId: id } });
                        if ((lockedCtx.estado === 'FINALIZADO' || partido.estado === 'FINALIZADO') && partido.jornadaId) {
                            await this._recalcularDivision(partido.jornadaId, tx);
                        }
                        return partido;
                    }, { isolationLevel: 'Serializable' });
                }
                catch (error) {
                    if (error?.code === 'P2034' && attempt < 2)
                        continue;
                    throw error;
                }
            }
        }
        return this._applyResult(id, data, ctx);
    },
    async updateResult(id, data, actor) {
        const initial = await repository_1.partidoRepository.findAuthorizationContext(id);
        if (!initial)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, initial.ligaUserId, 'Partido');
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await database_1.prisma.$transaction(async (tx) => {
                    await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, initial.ligaId);
                    const locked = await repository_1.partidoRepository.findAuthorizationContext(id, tx);
                    if (!locked)
                        throw new errors_1.NotFoundError('Partido');
                    (0, authorization_1.assertOwnerOrAdmin)(actor, locked.ligaUserId, 'Partido');
                    if (locked.ligaId !== initial.ligaId)
                        throw new errors_1.ConflictError('El partido cambió durante la actualización; vuelve a intentarlo');
                    return (0, resultWriter_1.writeResultInTransaction)(tx, id, data);
                }, { isolationLevel: 'Serializable' });
            }
            catch (error) {
                if (error?.code === 'P2034' && attempt < 2)
                    continue;
                if (error?.code === 'P2034')
                    throw new errors_1.ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo');
                throw error;
            }
        }
        throw new errors_1.ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo');
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
        return partido;
    },
    async delete(id, actor) {
        const ctx = await repository_1.partidoRepository.findAuthorizationContext(id);
        if (!ctx)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, ctx.ligaUserId, 'Partido');
        if (ctx.rondaPlayoffId) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    return await database_1.prisma.$transaction(async (tx) => {
                        await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ctx.ligaId);
                        const lockedCtx = await repository_1.partidoRepository.findAuthorizationContext(id, tx);
                        if (!lockedCtx)
                            throw new errors_1.NotFoundError('Partido');
                        (0, authorization_1.assertOwnerOrAdmin)(actor, lockedCtx.ligaUserId, 'Partido');
                        if (!lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
                            throw new errors_1.ConflictError('El partido cambió durante la eliminación; vuelve a intentarlo');
                        }
                        const partido = await repository_1.partidoRepository.delete(id, tx);
                        await service_2.rondaPlayoffService.syncAdvancement(tx, lockedCtx.rondaPlayoffId);
                        return partido;
                    }, { isolationLevel: 'Serializable' });
                }
                catch (error) {
                    if (error?.code === 'P2034' && attempt < 2)
                        continue;
                    if (error?.code === 'P2034')
                        throw new errors_1.ConflictError('El cuadro de playoff cambió durante la eliminación; vuelve a intentarlo');
                    throw error;
                }
            }
            throw new errors_1.ConflictError('El cuadro de playoff cambió durante la eliminación; vuelve a intentarlo');
        }
        if (ctx.jornadaId && !ctx.rondaPlayoffId) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    return await database_1.prisma.$transaction(async (tx) => {
                        await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, ctx.ligaId);
                        const lockedCtx = await repository_1.partidoRepository.findAuthorizationContext(id, tx);
                        if (!lockedCtx)
                            throw new errors_1.NotFoundError('Partido');
                        (0, authorization_1.assertOwnerOrAdmin)(actor, lockedCtx.ligaUserId, 'Partido');
                        if (!lockedCtx.jornadaId || lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
                            throw new errors_1.ConflictError('El partido cambió durante la eliminación; vuelve a intentarlo');
                        }
                        const partido = await repository_1.partidoRepository.delete(id, tx);
                        if (lockedCtx.estado === 'FINALIZADO') {
                            await this._recalcularDivision(lockedCtx.jornadaId, tx);
                        }
                        return partido;
                    }, { isolationLevel: 'Serializable' });
                }
                catch (error) {
                    if (error?.code === 'P2034' && attempt < 2)
                        continue;
                    throw error;
                }
            }
        }
        return repository_1.partidoRepository.delete(id);
    },
    async _recalcularDivision(jornadaId, tx) {
        const client = tx ?? database_1.prisma;
        const jornada = await client.jornada.findUnique({ where: { id: jornadaId }, select: { divisionId: true } });
        if (jornada) {
            await service_1.tablaPosicionService.recalcular(jornada.divisionId, tx);
        }
    },
};
//# sourceMappingURL=service.js.map