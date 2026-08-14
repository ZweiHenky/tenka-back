"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partidoRepository = exports.PARTIDO_READ_INCLUDE = exports.exposePartidoReadWithNotas = exports.exposePartidoRead = exports.exposeParticipacionRead = exports.exposeAnotacionRead = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
const exposeAnotacionRead = (anotacion) => ({
    id: anotacion.id,
    ladoMarcador: anotacion.ladoMarcador,
    cantidad: anotacion.cantidad,
    jugadorId: anotacion.jugadorId ?? anotacion.jugadorIdSnapshot ?? null,
    equipoId: anotacion.equipoId ?? anotacion.equipoIdSnapshot ?? null,
    jugadorNombre: anotacion.jugadorNombre ?? null,
    equipoNombre: anotacion.equipoNombre ?? null,
    dorsal: anotacion.dorsal ?? null,
});
exports.exposeAnotacionRead = exposeAnotacionRead;
const exposeParticipacionRead = (participacion) => ({
    id: participacion.id,
    ladoMarcador: participacion.ladoMarcador,
    jugadorId: participacion.jugadorId ?? participacion.jugadorIdSnapshot ?? null,
    equipoId: participacion.equipoId ?? participacion.equipoIdSnapshot ?? null,
    jugadorNombre: participacion.jugadorNombre,
    equipoNombre: participacion.equipoNombre,
    dorsal: participacion.dorsal ?? null,
});
exports.exposeParticipacionRead = exposeParticipacionRead;
const exposePartidoRead = (partido) => {
    const { notas: _notas, jornada: _jornada, rondaPlayoff: _rondaPlayoff, ...publicPartido } = partido;
    return {
        ...publicPartido,
        timeZone: partido.jornada?.division?.liga?.timeZone ?? partido.rondaPlayoff?.division?.liga?.timeZone,
        arbitros: partido.arbitros?.map((row) => row.arbitro),
        anotaciones: partido.anotaciones?.map(exports.exposeAnotacionRead),
        participaciones: partido.participaciones?.map(exports.exposeParticipacionRead),
    };
};
exports.exposePartidoRead = exposePartidoRead;
const exposePartidoReadWithNotas = (partido) => {
    const { jornada: _jornada, rondaPlayoff: _rondaPlayoff, ...rest } = partido;
    return {
        ...rest,
        timeZone: partido.jornada?.division?.liga?.timeZone ?? partido.rondaPlayoff?.division?.liga?.timeZone,
        arbitros: partido.arbitros?.map((row) => row.arbitro),
        anotaciones: partido.anotaciones?.map(exports.exposeAnotacionRead),
        participaciones: partido.participaciones?.map(exports.exposeParticipacionRead),
    };
};
exports.exposePartidoReadWithNotas = exposePartidoReadWithNotas;
const PARTIDO_OWNER_CONTEXT = {
    jornada: { select: { division: { select: { liga: { select: { userId: true, timeZone: true } } } } } },
    rondaPlayoff: { select: { division: { select: { liga: { select: { userId: true, timeZone: true } } } } } },
};
function isPartidoOwner(partido, actor) {
    if (!actor)
        return false;
    if (actor.rol === 'ADMINISTRADOR')
        return true;
    const ligaUserId = partido.jornada?.division?.liga?.userId ?? partido.rondaPlayoff?.division?.liga?.userId;
    return ligaUserId === actor.id;
}
exports.PARTIDO_READ_INCLUDE = {
    equipoLocal: { select: { id: true, nombre: true, logo: true } },
    equipoVisitante: { select: { id: true, nombre: true, logo: true } },
    cancha: { select: { id: true, nombre: true } },
    arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
};
const PARTIDO_DETAIL_INCLUDE = {
    ...exports.PARTIDO_READ_INCLUDE,
    ...PARTIDO_OWNER_CONTEXT,
    anotaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
    participaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
};
exports.partidoRepository = {
    async findAuthorizationContext(id, client = database_1.prisma) {
        const partido = await client.partido.findUnique({
            where: { id },
            select: {
                id: true,
                version: true,
                estado: true,
                golesLocal: true,
                golesVisitante: true,
                penalesLocal: true,
                penalesVisitante: true,
                fecha: true,
                fechaFin: true,
                canchaId: true,
                tipoPartido: true,
                equipoLocalId: true,
                equipoVisitanteId: true,
                jornadaId: true,
                rondaPlayoffId: true,
                jornada: { select: { division: { select: { id: true, ligaId: true, liga: { select: { userId: true, multiplesCanchas: true } } } } } },
                rondaPlayoff: { select: { division: { select: { id: true, ligaId: true, liga: { select: { userId: true, multiplesCanchas: true } } } } } },
            },
        });
        if (!partido)
            return null;
        const division = partido.jornada?.division ?? partido.rondaPlayoff?.division;
        return {
            id: partido.id,
            version: partido.version,
            ligaUserId: division?.liga.userId ?? '',
            ligaId: division?.ligaId ?? '',
            estado: partido.estado,
            golesLocal: partido.golesLocal,
            golesVisitante: partido.golesVisitante,
            penalesLocal: partido.penalesLocal,
            penalesVisitante: partido.penalesVisitante,
            jornadaId: partido.jornadaId,
            rondaPlayoffId: partido.rondaPlayoffId,
            divisionId: division?.id ?? null,
            tipoPartido: partido.tipoPartido,
            equipoLocalId: partido.equipoLocalId,
            equipoVisitanteId: partido.equipoVisitanteId,
            fecha: partido.fecha,
            fechaFin: partido.fechaFin,
            canchaId: partido.canchaId,
            multiplesCanchas: division?.liga.multiplesCanchas ?? false,
        };
    },
    async findAllVisible(actor) {
        const divisionWhere = (0, divisionVisibility_1.visibleDivisionWhere)(actor);
        const partidos = await database_1.prisma.partido.findMany({
            where: {
                OR: [
                    { jornada: { division: divisionWhere } },
                    { rondaPlayoff: { division: divisionWhere } },
                ],
            },
            include: exports.PARTIDO_READ_INCLUDE,
        });
        return partidos.map(exports.exposePartidoRead);
    },
    async findAllVisiblePaginated({ skip, take }, actor) {
        const divisionWhere = (0, divisionVisibility_1.visibleDivisionWhere)(actor);
        const where = {
            OR: [
                { jornada: { division: divisionWhere } },
                { rondaPlayoff: { division: divisionWhere } },
            ],
        };
        const [partidos, total] = await Promise.all([
            database_1.prisma.partido.findMany({ where, include: exports.PARTIDO_READ_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
            database_1.prisma.partido.count({ where }),
        ]);
        return { rows: partidos.map(exports.exposePartidoRead), total };
    },
    async findById(id) {
        const partido = await database_1.prisma.partido.findUnique({
            where: { id },
            include: PARTIDO_DETAIL_INCLUDE,
        });
        return partido ? (0, exports.exposePartidoRead)(partido) : null;
    },
    async findVisibleById(id, actor) {
        const divisionWhere = (0, divisionVisibility_1.visibleDivisionWhere)(actor);
        const partido = await database_1.prisma.partido.findFirst({
            where: {
                id,
                OR: [
                    { jornada: { division: divisionWhere } },
                    { rondaPlayoff: { division: divisionWhere } },
                ],
            },
            include: PARTIDO_DETAIL_INCLUDE,
        });
        return partido
            ? (isPartidoOwner(partido, actor) ? (0, exports.exposePartidoReadWithNotas)(partido) : (0, exports.exposePartidoRead)(partido))
            : null;
    },
    async findByJornada(jornadaId) {
        const partidos = await database_1.prisma.partido.findMany({
            where: { jornadaId },
            include: exports.PARTIDO_READ_INCLUDE,
        });
        return partidos.map(exports.exposePartidoRead);
    },
    async findVisibleByJornada(jornadaId, actor) {
        const jornada = await database_1.prisma.jornada.findFirst({
            where: { id: jornadaId, division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: { partidos: { include: exports.PARTIDO_READ_INCLUDE } },
        });
        return jornada ? jornada.partidos.map(exports.exposePartidoRead) : null;
    },
    async findByRondaPlayoff(rondaPlayoffId) {
        const partidos = await database_1.prisma.partido.findMany({
            where: { rondaPlayoffId },
            include: exports.PARTIDO_READ_INCLUDE,
        });
        return partidos.map(exports.exposePartidoRead);
    },
    async findVisibleByRondaPlayoff(rondaPlayoffId, actor) {
        const ronda = await database_1.prisma.rondaPlayoff.findFirst({
            where: { id: rondaPlayoffId, division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: { partidos: { include: exports.PARTIDO_READ_INCLUDE } },
        });
        return ronda ? ronda.partidos.map(exports.exposePartidoRead) : null;
    },
    async create(data) {
        return database_1.prisma.partido.create({ data: data });
    },
    async update(id, data, client = database_1.prisma) {
        const partido = await client.partido.update({
            where: { id },
            data,
            include: exports.PARTIDO_READ_INCLUDE,
        });
        return (0, exports.exposePartidoRead)(partido);
    },
    async delete(id, client = database_1.prisma) {
        const partido = await client.partido.delete({ where: { id }, include: exports.PARTIDO_READ_INCLUDE });
        return (0, exports.exposePartidoRead)(partido);
    },
};
//# sourceMappingURL=repository.js.map