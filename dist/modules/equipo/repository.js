"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipoRepository = void 0;
const database_1 = require("../../config/database");
exports.equipoRepository = {
    async findAll() {
        return database_1.prisma.equipo.findMany({ orderBy: { nombre: 'asc' } });
    },
    async findAllPaginated({ skip, take }) {
        const [rows, total] = await Promise.all([
            database_1.prisma.equipo.findMany({ orderBy: { nombre: 'asc' }, skip, take }),
            database_1.prisma.equipo.count(),
        ]);
        return { rows, total };
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
    async create(data, tx) {
        return (tx ?? database_1.prisma).equipo.create({ data });
    },
    async update(id, data, tx) {
        return (tx ?? database_1.prisma).equipo.update({ where: { id }, data });
    },
    async delete(id, tx) {
        await (tx ?? database_1.prisma).equipo.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map