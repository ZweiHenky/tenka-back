"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rondaPlayoffRepository = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
const repository_1 = require("../partido/repository");
exports.rondaPlayoffRepository = {
    async findAll() {
        return database_1.prisma.rondaPlayoff.findMany();
    },
    async findById(id) {
        return database_1.prisma.rondaPlayoff.findUnique({ where: { id } });
    },
    async findVisibleById(id, actor) {
        return database_1.prisma.rondaPlayoff.findFirst({
            where: { id, division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) },
        });
    },
    async findByDivision(divisionId) {
        return database_1.prisma.rondaPlayoff.findMany({ where: { divisionId }, orderBy: { orden: 'asc' } });
    },
    async findVisibleByDivision(divisionId, actor) {
        const division = await database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            select: {
                rondasPlayoff: {
                    orderBy: { orden: 'asc' },
                    include: { partidos: { include: repository_1.PARTIDO_READ_INCLUDE } },
                },
            },
        });
        return division?.rondasPlayoff.map((ronda) => ({
            ...ronda,
            partidos: ronda.partidos.map(repository_1.exposePartidoRead),
        })) ?? null;
    },
    async create(data) {
        return database_1.prisma.rondaPlayoff.create({ data: data });
    },
    async update(id, data) {
        return database_1.prisma.rondaPlayoff.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.rondaPlayoff.delete({ where: { id } });
    },
    async deleteByDivision(divisionId) {
        await database_1.prisma.rondaPlayoff.deleteMany({ where: { divisionId } });
    },
};
//# sourceMappingURL=repository.js.map