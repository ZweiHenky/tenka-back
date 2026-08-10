"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResultContext = getResultContext;
exports.writeResultInTransaction = writeResultInTransaction;
const errors_1 = require("../../utils/errors");
const service_1 = require("../tabla-posicion/service");
const service_2 = require("../ronda-playoff/service");
const playoffFinalization_1 = require("./playoffFinalization");
const repository_1 = require("./repository");
const RESULT_CONTEXT_SELECT = {
    id: true,
    version: true,
    estado: true,
    golesLocal: true,
    golesVisitante: true,
    penalesLocal: true,
    penalesVisitante: true,
    tipoPartido: true,
    jornadaId: true,
    rondaPlayoffId: true,
    equipoLocalId: true,
    equipoVisitanteId: true,
    fecha: true,
    fechaFin: true,
    canchaId: true,
    jornada: { select: { division: { select: { id: true, registrarParticipaciones: true, usarPenalesEnEmpates: true, liga: { select: { id: true, userId: true, multiplesCanchas: true } } } } } },
    rondaPlayoff: { select: { division: { select: { id: true, registrarParticipaciones: true, usarPenalesEnEmpates: true, liga: { select: { id: true, userId: true, multiplesCanchas: true } } } } } },
};
async function getResultContext(tx, partidoId) {
    const partido = await tx.partido.findUnique({ where: { id: partidoId }, select: RESULT_CONTEXT_SELECT });
    if (!partido)
        throw new errors_1.NotFoundError('Partido');
    const division = partido.jornada?.division ?? partido.rondaPlayoff?.division;
    if (!division)
        throw new errors_1.ValidationError('El partido no pertenece a una división');
    return { partido, division };
}
async function writeResultInTransaction(tx, partidoId, input) {
    const { partido, division } = await getResultContext(tx, partidoId);
    if (partido.version !== input.expectedVersion) {
        throw new errors_1.ConflictError('El resultado cambió; actualiza los datos y vuelve a intentarlo');
    }
    if (input.estado === 'FINALIZADO') {
        const tied = input.golesLocal === input.golesVisitante;
        const hasLocalPenalties = input.penalesLocal != null;
        const hasVisitorPenalties = input.penalesVisitante != null;
        const hasAnyPenalties = hasLocalPenalties || hasVisitorPenalties;
        const hasCompletePenalties = hasLocalPenalties && hasVisitorPenalties;
        const requiresPenalties = tied && (partido.rondaPlayoffId != null
            || (partido.tipoPartido !== 'AMISTOSO' && division.usarPenalesEnEmpates));
        if (!tied && hasAnyPenalties) {
            throw new errors_1.ValidationError('Los penales solo pueden registrarse cuando el marcador está empatado');
        }
        if (requiresPenalties && (!hasCompletePenalties || input.penalesLocal === input.penalesVisitante)) {
            throw new errors_1.ValidationError(partido.rondaPlayoffId
                ? 'El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.'
                : 'El empate debe definir un ganador por penales.');
        }
        if (!requiresPenalties && hasAnyPenalties) {
            throw new errors_1.ValidationError('Esta división no usa penales para resolver empates');
        }
    }
    if (input.estado === 'FINALIZADO' && partido.rondaPlayoffId) {
        const scheduleError = (0, playoffFinalization_1.validatePlayoffFinalizationSchedule)({
            fecha: partido.fecha,
            fechaFin: partido.fechaFin,
            multiplesCanchas: division.liga.multiplesCanchas,
            canchaId: partido.canchaId,
        });
        if (scheduleError)
            throw new errors_1.ValidationError(scheduleError);
    }
    if (partido.estado === 'FINALIZADO' && partido.rondaPlayoffId && input.estado === 'PROGRAMADO') {
        throw new errors_1.ValidationError('Un partido de eliminatoria finalizado solo puede corregirse o suspenderse');
    }
    if (input.estado !== 'FINALIZADO' && (input.notas !== undefined || input.participaciones !== undefined)) {
        throw new errors_1.ValidationError('Las notas y los participantes solo pueden guardarse al finalizar el partido');
    }
    const namedKeys = new Set();
    const totals = { LOCAL: 0, VISITANTE: 0 };
    const namedPlayerIds = [];
    for (const allocation of input.allocations) {
        totals[allocation.ladoMarcador] += allocation.cantidad;
        if (!allocation.jugadorId)
            continue;
        const key = `${allocation.ladoMarcador}:${allocation.jugadorId}`;
        if (namedKeys.has(key))
            throw new errors_1.ValidationError('No se puede repetir un jugador en el mismo lado del marcador');
        namedKeys.add(key);
        namedPlayerIds.push(allocation.jugadorId);
    }
    if (totals.LOCAL > input.golesLocal || totals.VISITANTE > input.golesVisitante) {
        throw new errors_1.ValidationError('Las anotaciones asignadas no pueden superar el marcador');
    }
    const shouldWriteParticipations = division.registrarParticipaciones && input.estado === 'FINALIZADO';
    if (shouldWriteParticipations && input.participaciones === undefined) {
        throw new errors_1.ValidationError('Debes registrar los jugadores que participaron en el partido');
    }
    const participacionList = shouldWriteParticipations ? (input.participaciones ?? []) : [];
    const participationKeys = new Set();
    const participationUniquePlayers = new Set();
    const participationPlayerIds = [];
    if (shouldWriteParticipations) {
        for (const participacion of participacionList) {
            const key = `${participacion.ladoMarcador}:${participacion.jugadorId}`;
            if (participationKeys.has(key)) {
                throw new errors_1.ValidationError('No se puede repetir un jugador en el mismo lado de la participación');
            }
            participationKeys.add(key);
            if (participationUniquePlayers.has(participacion.jugadorId)) {
                throw new errors_1.ValidationError('Un jugador no puede participar por ambos equipos');
            }
            participationUniquePlayers.add(participacion.jugadorId);
            participationPlayerIds.push(participacion.jugadorId);
        }
        for (const allocation of input.allocations) {
            if (!allocation.jugadorId)
                continue;
            if (!participationKeys.has(`${allocation.ladoMarcador}:${allocation.jugadorId}`)) {
                throw new errors_1.ValidationError('Todos los goleadores deben estar registrados como participantes del partido');
            }
        }
    }
    const historicalParticipations = !shouldWriteParticipations && input.estado === 'FINALIZADO'
        ? await tx.participacionPartido.findMany({
            where: { partidoId },
            select: { jugadorId: true, jugadorIdSnapshot: true, ladoMarcador: true },
        })
        : [];
    if (historicalParticipations.length > 0) {
        const historyKeys = new Set(historicalParticipations.map((row) => `${row.ladoMarcador}:${row.jugadorId ?? row.jugadorIdSnapshot}`));
        for (const allocation of input.allocations) {
            if (!allocation.jugadorId)
                continue;
            if (!historyKeys.has(`${allocation.ladoMarcador}:${allocation.jugadorId}`)) {
                throw new errors_1.ValidationError('El goleador no está en el historial de participantes del partido. Activa el registro de participantes para corregir la lista');
            }
        }
    }
    const memberships = namedPlayerIds.length === 0 && participationPlayerIds.length === 0 ? [] : await tx.divisionJugador.findMany({
        where: { divisionId: division.id, jugadorId: { in: [...new Set([...namedPlayerIds, ...participationPlayerIds])] } },
        select: {
            jugadorId: true,
            equipoId: true,
            dorsal: true,
            jugador: { select: { nombre: true } },
            equipo: { select: { nombre: true } },
        },
    });
    const teamIds = { LOCAL: partido.equipoLocalId, VISITANTE: partido.equipoVisitanteId };
    const membershipByTeamPlayer = new Map(memberships.map((membership) => [`${membership.equipoId}:${membership.jugadorId}`, membership]));
    const namedPlayerIdsSet = new Set(namedPlayerIds);
    const participationPlayerIdsSet = new Set(participationPlayerIds);
    const previousAllocations = namedPlayerIdsSet.size === 0 ? [] : await tx.anotacionPartido.findMany({
        where: {
            partidoId,
            OR: [
                { jugadorId: { in: [...namedPlayerIdsSet] } },
                { jugadorIdSnapshot: { in: [...namedPlayerIdsSet] } },
            ],
        },
        select: { jugadorId: true, jugadorIdSnapshot: true, equipoId: true, equipoIdSnapshot: true, ladoMarcador: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
    });
    const previousParticipations = participationPlayerIdsSet.size === 0 ? [] : await tx.participacionPartido.findMany({
        where: {
            partidoId,
            OR: [
                { jugadorId: { in: [...participationPlayerIdsSet] } },
                { jugadorIdSnapshot: { in: [...participationPlayerIdsSet] } },
            ],
        },
        select: { jugadorId: true, jugadorIdSnapshot: true, equipoId: true, equipoIdSnapshot: true, ladoMarcador: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
    });
    const namedRows = input.allocations.filter((allocation) => allocation.jugadorId).map((allocation) => {
        const equipoId = teamIds[allocation.ladoMarcador];
        const membership = membershipByTeamPlayer.get(`${equipoId}:${allocation.jugadorId}`);
        const previous = previousAllocations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === allocation.jugadorId
            && row.ladoMarcador === allocation.ladoMarcador);
        if (!membership && !previous) {
            throw new errors_1.ValidationError('El jugador no pertenece al equipo y división correspondientes al partido');
        }
        return {
            partidoId,
            jugadorId: membership ? allocation.jugadorId : (previous?.jugadorId ?? null),
            equipoId: membership ? equipoId : (previous?.equipoId ?? null),
            jugadorIdSnapshot: previous?.jugadorIdSnapshot ?? allocation.jugadorId,
            equipoIdSnapshot: previous?.equipoIdSnapshot ?? equipoId,
            ladoMarcador: allocation.ladoMarcador,
            cantidad: allocation.cantidad,
            jugadorNombre: previous?.jugadorNombre ?? membership?.jugador.nombre ?? 'Jugador',
            equipoNombre: previous?.equipoNombre ?? membership?.equipo.nombre ?? 'Equipo',
            dorsal: previous ? previous.dorsal : (membership?.dorsal ?? null),
        };
    });
    const participationRows = participacionList.map((participacion) => {
        const equipoId = teamIds[participacion.ladoMarcador];
        const membership = membershipByTeamPlayer.get(`${equipoId}:${participacion.jugadorId}`);
        const previous = previousParticipations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === participacion.jugadorId
            && row.ladoMarcador === participacion.ladoMarcador)
            ?? previousAllocations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === participacion.jugadorId
                && row.ladoMarcador === participacion.ladoMarcador);
        if (!membership && !previous) {
            throw new errors_1.ValidationError('El jugador no pertenece al equipo y división correspondientes al partido');
        }
        return {
            partidoId,
            jugadorId: membership ? participacion.jugadorId : (previous?.jugadorId ?? null),
            equipoId: membership ? equipoId : (previous?.equipoId ?? null),
            jugadorIdSnapshot: previous?.jugadorIdSnapshot ?? participacion.jugadorId,
            equipoIdSnapshot: previous?.equipoIdSnapshot ?? equipoId,
            ladoMarcador: participacion.ladoMarcador,
            jugadorNombre: previous?.jugadorNombre ?? membership?.jugador.nombre ?? 'Jugador',
            equipoNombre: previous?.equipoNombre ?? membership?.equipo.nombre ?? 'Equipo',
            dorsal: previous ? previous.dorsal : (membership?.dorsal ?? null),
        };
    });
    const updatedCount = await tx.partido.updateMany({
        where: { id: partidoId, version: input.expectedVersion },
        data: input.estado === 'PROGRAMADO'
            ? { estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null, version: { increment: 1 } }
            : input.estado === 'SUSPENDIDO'
                ? {
                    estado: 'SUSPENDIDO',
                    golesLocal: partido.golesLocal,
                    golesVisitante: partido.golesVisitante,
                    penalesLocal: partido.penalesLocal,
                    penalesVisitante: partido.penalesVisitante,
                    version: { increment: 1 },
                }
                : {
                    estado: input.estado,
                    golesLocal: input.golesLocal,
                    golesVisitante: input.golesVisitante,
                    penalesLocal: input.penalesLocal ?? null,
                    penalesVisitante: input.penalesVisitante ?? null,
                    ...(input.notas !== undefined ? { notas: input.notas } : {}),
                    version: { increment: 1 },
                },
    });
    if (updatedCount.count !== 1)
        throw new errors_1.ConflictError('El resultado cambió; actualiza los datos y vuelve a intentarlo');
    if (input.estado === 'PROGRAMADO') {
        await tx.anotacionPartido.deleteMany({ where: { partidoId } });
        await tx.participacionPartido.deleteMany({ where: { partidoId } });
    }
    else if (input.estado === 'FINALIZADO') {
        const teamRows = await tx.equipo.findMany({
            where: { id: { in: [partido.equipoLocalId, partido.equipoVisitanteId].filter((id) => Boolean(id)) } },
            select: { id: true, nombre: true },
        });
        const teamNames = new Map(teamRows.map((team) => [team.id, team.nombre]));
        const unattributedRows = ['LOCAL', 'VISITANTE'].flatMap((side) => {
            const score = side === 'LOCAL' ? input.golesLocal : input.golesVisitante;
            const namedTotal = namedRows.filter((row) => row.ladoMarcador === side).reduce((sum, row) => sum + row.cantidad, 0);
            const cantidad = score - namedTotal;
            const equipoId = teamIds[side];
            return cantidad > 0 ? [{
                    partidoId,
                    jugadorId: null,
                    equipoId,
                    jugadorIdSnapshot: null,
                    equipoIdSnapshot: equipoId,
                    ladoMarcador: side,
                    cantidad,
                    jugadorNombre: null,
                    equipoNombre: equipoId ? teamNames.get(equipoId) ?? null : null,
                    dorsal: null,
                }] : [];
        });
        await tx.anotacionPartido.deleteMany({ where: { partidoId } });
        if (namedRows.length + unattributedRows.length > 0) {
            await tx.anotacionPartido.createMany({ data: [...namedRows, ...unattributedRows] });
        }
        if (shouldWriteParticipations) {
            await tx.participacionPartido.deleteMany({ where: { partidoId } });
            if (participationRows.length > 0) {
                await tx.participacionPartido.createMany({ data: participationRows });
            }
        }
    }
    if (partido.jornadaId && (partido.estado === 'FINALIZADO' || input.estado === 'FINALIZADO' || input.estado === 'PROGRAMADO' || input.estado === 'SUSPENDIDO')) {
        await service_1.tablaPosicionService.recalcular(division.id, tx);
    }
    if (partido.rondaPlayoffId)
        await service_2.rondaPlayoffService.syncAdvancement(tx, partido.rondaPlayoffId);
    const updated = await tx.partido.findUnique({
        where: { id: partidoId },
        include: {
            anotaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
            participaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
        },
    });
    return updated ? (0, repository_1.exposePartidoReadWithNotas)(updated) : updated;
}
//# sourceMappingURL=resultWriter.js.map