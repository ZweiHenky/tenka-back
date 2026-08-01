"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partidoRepository = exports.PARTIDO_READ_INCLUDE = exports.exposePartidoRead = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
const exposePartidoRead = (partido) => ({ ...partido, arbitros: partido.arbitros?.map((row) => row.arbitro) });
exports.exposePartidoRead = exposePartidoRead;
exports.PARTIDO_READ_INCLUDE = {
    equipoLocal: { select: { id: true, nombre: true, logo: true } },
    equipoVisitante: { select: { id: true, nombre: true, logo: true } },
    cancha: { select: { id: true, nombre: true } },
    arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
};
exports.partidoRepository = {
    async findAuthorizationContext(id) {
        const partido = await database_1.prisma.partido.findUnique({
            where: { id },
            select: {
                id: true,
                estado: true,
                golesLocal: true,
                golesVisitante: true,
                penalesLocal: true,
                penalesVisitante: true,
                fecha: true,
                fechaFin: true,
                tipoPartido: true,
                equipoLocalId: true,
                equipoVisitanteId: true,
                jornadaId: true,
                rondaPlayoffId: true,
                jornada: { select: { division: { select: { id: true, liga: { select: { userId: true } } } } } },
                rondaPlayoff: { select: { division: { select: { id: true, liga: { select: { userId: true } } } } } },
            },
        });
        if (!partido)
            return null;
        const division = partido.jornada?.division ?? partido.rondaPlayoff?.division;
        return {
            id: partido.id,
            ligaUserId: division?.liga.userId ?? '',
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
    async findById(id) {
        const partido = await database_1.prisma.partido.findUnique({
            where: { id },
            include: exports.PARTIDO_READ_INCLUDE,
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
            include: exports.PARTIDO_READ_INCLUDE,
        });
        return partido ? (0, exports.exposePartidoRead)(partido) : null;
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
    async update(id, data) {
        const partido = await database_1.prisma.partido.update({
            where: { id },
            data,
            include: exports.PARTIDO_READ_INCLUDE,
        });
        return (0, exports.exposePartidoRead)(partido);
    },
    async delete(id) {
        await database_1.prisma.partido.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map