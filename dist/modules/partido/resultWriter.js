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
    jornadaId: true,
    rondaPlayoffId: true,
    equipoLocalId: true,
    equipoVisitanteId: true,
    fecha: true,
    fechaFin: true,
    canchaId: true,
    jornada: { select: { division: { select: { id: true, liga: { select: { id: true, userId: true, multiplesCanchas: true } } } } } },
    rondaPlayoff: { select: { division: { select: { id: true, liga: { select: { id: true, userId: true, multiplesCanchas: true } } } } } },
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
    if (input.estado === 'FINALIZADO' && partido.rondaPlayoffId) {
        const scheduleError = (0, playoffFinalization_1.validatePlayoffFinalizationSchedule)({
            fecha: partido.fecha,
            fechaFin: partido.fechaFin,
            multiplesCanchas: division.liga.multiplesCanchas,
            canchaId: partido.canchaId,
        });
        if (scheduleError)
            throw new errors_1.ValidationError(scheduleError);
        if (input.golesLocal === input.golesVisitante
            && (input.penalesLocal == null || input.penalesVisitante == null || input.penalesLocal === input.penalesVisitante)) {
            throw new errors_1.ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.');
        }
    }
    if (partido.estado === 'FINALIZADO' && partido.rondaPlayoffId && input.estado === 'PROGRAMADO') {
        throw new errors_1.ValidationError('Un partido de eliminatoria finalizado solo puede corregirse o suspenderse');
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
    const memberships = namedPlayerIds.length === 0 ? [] : await tx.divisionJugador.findMany({
        where: { divisionId: division.id, jugadorId: { in: [...new Set(namedPlayerIds)] } },
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
    const previousAllocations = namedPlayerIds.length === 0 ? [] : await tx.anotacionPartido.findMany({
        where: { partidoId, jugadorId: { in: [...new Set(namedPlayerIds)] } },
        select: { jugadorId: true, jugadorIdSnapshot: true, equipoId: true, equipoIdSnapshot: true, ladoMarcador: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
    });
    const namedRows = input.allocations.filter((allocation) => allocation.jugadorId).map((allocation) => {
        const equipoId = teamIds[allocation.ladoMarcador];
        const membership = membershipByTeamPlayer.get(`${equipoId}:${allocation.jugadorId}`);
        const previous = previousAllocations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === allocation.jugadorId
            && (row.equipoId ?? row.equipoIdSnapshot) === equipoId && row.ladoMarcador === allocation.ladoMarcador);
        if (!membership && !previous) {
            throw new errors_1.ValidationError('El jugador no pertenece al equipo y división correspondientes al partido');
        }
        return {
            partidoId,
            jugadorId: allocation.jugadorId,
            equipoId,
            jugadorIdSnapshot: allocation.jugadorId,
            equipoIdSnapshot: equipoId,
            ladoMarcador: allocation.ladoMarcador,
            cantidad: allocation.cantidad,
            jugadorNombre: membership?.jugador.nombre ?? previous?.jugadorNombre ?? 'Jugador',
            equipoNombre: membership?.equipo.nombre ?? previous?.equipoNombre ?? 'Equipo',
            dorsal: membership?.dorsal ?? previous?.dorsal ?? null,
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
                    version: { increment: 1 },
                },
    });
    if (updatedCount.count !== 1)
        throw new errors_1.ConflictError('El resultado cambió; actualiza los datos y vuelve a intentarlo');
    if (input.estado === 'PROGRAMADO') {
        await tx.anotacionPartido.deleteMany({ where: { partidoId } });
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
    }
    if (partido.jornadaId && (partido.estado === 'FINALIZADO' || input.estado === 'FINALIZADO' || input.estado === 'PROGRAMADO' || input.estado === 'SUSPENDIDO')) {
        await service_1.tablaPosicionService.recalcular(division.id, tx);
    }
    if (partido.rondaPlayoffId)
        await service_2.rondaPlayoffService.syncAdvancement(tx, partido.rondaPlayoffId);
    const updated = await tx.partido.findUnique({
        where: { id: partidoId },
        include: { anotaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] } },
    });
    return updated ? (0, repository_1.exposePartidoRead)(updated) : updated;
}
//# sourceMappingURL=resultWriter.js.map