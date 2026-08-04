"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disponibilidadCanchaRepository = void 0;
const database_1 = require("../../config/database");
exports.disponibilidadCanchaRepository = {
    findLeagueContext(ligaId, actor) {
        return database_1.prisma.liga.findFirst({
            where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
            select: {
                id: true,
                multiplesCanchas: true,
                canchas: {
                    where: { activa: true },
                    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
                    select: { id: true, nombre: true },
                },
            },
        });
    },
    async findOccupancy(ligaId, inicio, fin) {
        const partidos = await database_1.prisma.partido.findMany({
            where: {
                fecha: { lt: fin },
                fechaFin: { gt: inicio },
                OR: [
                    { jornada: { division: { ligaId } } },
                    { rondaPlayoff: { division: { ligaId } } },
                ],
            },
            orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                fecha: true,
                fechaFin: true,
                canchaId: true,
                jornada: { select: { division: { select: { id: true, nombre: true } } } },
                rondaPlayoff: { select: { division: { select: { id: true, nombre: true } } } },
            },
        });
        return partidos.map((partido) => ({
            id: partido.id,
            fecha: partido.fecha,
            fechaFin: partido.fechaFin,
            canchaId: partido.canchaId,
            division: (partido.jornada?.division ?? partido.rondaPlayoff?.division),
        }));
    },
};
//# sourceMappingURL=repository.js.map