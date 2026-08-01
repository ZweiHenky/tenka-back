"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tipoRepository = void 0;
const database_1 = require("../../config/database");
exports.tipoRepository = {
    async findAll() { return database_1.prisma.tipo.findMany({ orderBy: { nombre: 'asc' } }); },
    async findById(id) { return database_1.prisma.tipo.findUnique({ where: { id } }); },
    async create(data) { return database_1.prisma.tipo.create({ data }); },
    async update(id, data) { return database_1.prisma.tipo.update({ where: { id }, data }); },
    async delete(id) { await database_1.prisma.tipo.delete({ where: { id } }); },
};
//# sourceMappingURL=repository.js.map