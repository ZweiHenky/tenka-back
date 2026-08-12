"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ubicacionRepository = void 0;
const database_1 = require("../../config/database");
exports.ubicacionRepository = {
    async findAll() {
        return database_1.prisma.ubicacion.findMany({ orderBy: { nombreCompleto: 'asc' } });
    },
    async findAllPaginated({ skip, take }) {
        const [rows, total] = await Promise.all([
            database_1.prisma.ubicacion.findMany({ orderBy: { nombreCompleto: 'asc' }, skip, take }),
            database_1.prisma.ubicacion.count(),
        ]);
        return { rows, total };
    },
    async findById(id) {
        return database_1.prisma.ubicacion.findUnique({ where: { id } });
    },
    async findOrCreate(data) {
        const existing = await database_1.prisma.ubicacion.findFirst({ where: { nombreCompleto: data.nombreCompleto, estado: data.estado } });
        if (existing)
            return existing;
        return database_1.prisma.ubicacion.create({ data });
    },
    async create(data) {
        return database_1.prisma.ubicacion.create({ data });
    },
    async update(id, data) {
        return database_1.prisma.ubicacion.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.ubicacion.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map