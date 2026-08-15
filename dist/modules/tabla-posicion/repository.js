"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tablaPosicionRepository = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
exports.tablaPosicionRepository = {
    async findByDivision(divisionId, actor) {
        return database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: {
                tablaPosiciones: {
                    include: { equipo: { select: { id: true, nombre: true, logo: true } } },
                    orderBy: { puntos: 'desc' },
                },
            },
        });
    },
    async findTeamsByDivision(divisionId, actor) {
        return database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: {
                equipos: {
                    select: {
                        equipoId: true,
                        equipo: { select: { id: true, nombre: true, logo: true } },
                    },
                },
            },
        });
    },
    async findOne(divisionId, equipoId, actor) {
        return database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: {
                tablaPosiciones: { where: { equipoId } },
            },
        });
    },
    async upsert(divisionId, equipoId, data) {
        return database_1.prisma.tablaPosicion.upsert({
            where: { divisionId_equipoId: { divisionId, equipoId } },
            create: { divisionId, equipoId, ...data },
            update: data,
        });
    },
    async delete(divisionId, equipoId) {
        await database_1.prisma.tablaPosicion.delete({ where: { divisionId_equipoId: { divisionId, equipoId } } });
    },
};
//# sourceMappingURL=repository.js.map