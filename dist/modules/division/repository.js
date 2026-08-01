"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionRepository = void 0;
const database_1 = require("../../config/database");
exports.divisionRepository = {
    async findAll() {
        return database_1.prisma.division.findMany({ orderBy: { createdAt: 'desc' } });
    },
    async findById(id) {
        return database_1.prisma.division.findUnique({
            where: { id },
            include: {
                liga: { select: { id: true, nombre: true, logo: true } },
                estadoLiga: { select: { id: true, nombre: true } },
            },
        });
    },
    async findByLiga(ligaId) {
        return database_1.prisma.division.findMany({ where: { ligaId }, orderBy: { createdAt: 'desc' } });
    },
    async create(data) {
        return database_1.prisma.division.create({ data: data });
    },
    async update(id, data) {
        return database_1.prisma.division.update({ where: { id }, data });
    },
    async delete(id, tx) {
        await (tx ?? database_1.prisma).division.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map