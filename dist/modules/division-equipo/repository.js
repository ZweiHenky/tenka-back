"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionEquipoRepository = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
exports.divisionEquipoRepository = {
    async findByDivision(divisionId, actor) {
        const includeSaldo = actor !== undefined;
        const includeOwner = includeSaldo && actor.rol !== 'ADMINISTRADOR';
        const division = await database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: {
                equipos: {
                    select: {
                        divisionId: true,
                        equipoId: true,
                        ...(includeSaldo ? { saldoPendiente: true } : {}),
                    },
                },
                ...(includeOwner ? { liga: { select: { userId: true } } } : {}),
            },
        });
        if (!division)
            return null;
        const canViewSaldo = actor?.rol === 'ADMINISTRADOR'
            || (includeOwner && 'liga' in division && division.liga.userId === actor?.id);
        return division.equipos.map((pivot) => ({
            divisionId: pivot.divisionId,
            equipoId: pivot.equipoId,
            ...(canViewSaldo && 'saldoPendiente' in pivot
                ? { saldoPendiente: pivot.saldoPendiente.toFixed(2) }
                : {}),
        }));
    },
    async findByEquipo(equipoId, actor) {
        return database_1.prisma.divisionEquipo.findMany({
            where: { equipoId, division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: {
                divisionId: true,
                equipoId: true,
                division: {
                    include: {
                        liga: { select: { id: true, nombre: true, logo: true } },
                        estadoLiga: { select: { id: true, nombre: true } },
                    },
                },
            },
        });
    },
    async create(data, tx) {
        const pivot = await (tx ?? database_1.prisma).divisionEquipo.create({ data });
        return {
            divisionId: pivot.divisionId,
            equipoId: pivot.equipoId,
            saldoPendiente: pivot.saldoPendiente.toFixed(2),
        };
    },
    async updateSaldoPendiente(divisionId, equipoId, saldoPendiente, actor) {
        const result = await database_1.prisma.divisionEquipo.updateMany({
            where: {
                divisionId,
                equipoId,
                ...(actor.rol === 'ADMINISTRADOR' ? {} : { division: { liga: { userId: actor.id } } }),
            },
            data: { saldoPendiente },
        });
        return result.count === 1;
    },
    async delete(divisionId, equipoId, tx) {
        await (tx ?? database_1.prisma).divisionEquipo.delete({ where: { divisionId_equipoId: { divisionId, equipoId } } });
    },
};
//# sourceMappingURL=repository.js.map