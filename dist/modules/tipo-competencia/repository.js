"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tipoCompetenciaRepository = void 0;
const database_1 = require("../../config/database");
exports.tipoCompetenciaRepository = {
    async findAll() {
        return database_1.prisma.tipoCompetencia.findMany({ orderBy: { nombre: 'asc' } });
    },
    async findById(id) {
        return database_1.prisma.tipoCompetencia.findUnique({ where: { id } });
    },
    async create(data) {
        return database_1.prisma.tipoCompetencia.create({ data });
    },
    async update(id, data) {
        return database_1.prisma.tipoCompetencia.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.tipoCompetencia.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map