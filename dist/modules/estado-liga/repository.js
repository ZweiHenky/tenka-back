"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estadoLigaRepository = void 0;
const database_1 = require("../../config/database");
exports.estadoLigaRepository = {
    async findAll() {
        return database_1.prisma.estadoLiga.findMany({ orderBy: { nombre: 'asc' } });
    },
    async findById(id) {
        return database_1.prisma.estadoLiga.findUnique({ where: { id } });
    },
    async create(data) {
        return database_1.prisma.estadoLiga.create({ data });
    },
    async update(id, data) {
        return database_1.prisma.estadoLiga.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.estadoLiga.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map