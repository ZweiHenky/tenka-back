"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriaRepository = void 0;
const database_1 = require("../../config/database");
exports.categoriaRepository = {
    async findAll() {
        return database_1.prisma.categoria.findMany({ orderBy: { nombre: 'asc' } });
    },
    async findById(id) {
        return database_1.prisma.categoria.findUnique({ where: { id } });
    },
    async create(data) {
        return database_1.prisma.categoria.create({ data });
    },
    async update(id, data) {
        return database_1.prisma.categoria.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.categoria.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map