"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.premioRepository = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
exports.premioRepository = {
    async findAll() {
        return database_1.prisma.premio.findMany();
    },
    async findById(id) {
        return database_1.prisma.premio.findUnique({ where: { id } });
    },
    async findVisibleById(id, actor) {
        return database_1.prisma.premio.findFirst({
            where: { id, division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) },
        });
    },
    async findByDivision(divisionId) {
        return database_1.prisma.premio.findMany({ where: { divisionId }, orderBy: { posicion: 'asc' } });
    },
    async findVisibleByDivision(divisionId, actor) {
        const division = await database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: { premios: { orderBy: { posicion: 'asc' } } },
        });
        return division?.premios ?? null;
    },
    async create(data) {
        return database_1.prisma.premio.create({ data });
    },
    async update(id, data) {
        return database_1.prisma.premio.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.premio.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map