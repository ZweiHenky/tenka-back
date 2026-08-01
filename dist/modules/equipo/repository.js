"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipoRepository = void 0;
const database_1 = require("../../config/database");
exports.equipoRepository = {
    async findAll() {
        return database_1.prisma.equipo.findMany({ orderBy: { nombre: 'asc' } });
    },
    async findByUser(userId) {
        return database_1.prisma.equipo.findMany({ where: { userId }, orderBy: { nombre: 'asc' } });
    },
    async findById(id) {
        return database_1.prisma.equipo.findUnique({ where: { id } });
    },
    async findByNormalizedName(userId, nombreNormalizado, excludeId) {
        return database_1.prisma.equipo.findFirst({
            where: { userId, nombreNormalizado, ...(excludeId ? { id: { not: excludeId } } : {}) },
        });
    },
    async create(data) {
        return database_1.prisma.equipo.create({ data });
    },
    async update(id, data) {
        return database_1.prisma.equipo.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.equipo.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map