"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaEquipoRepository = void 0;
const database_1 = require("../../config/database");
exports.ligaEquipoRepository = {
    async findByLiga(ligaId) {
        return database_1.prisma.ligaEquipo.findMany({ where: { ligaId } });
    },
    async findByEquipo(equipoId) {
        return database_1.prisma.ligaEquipo.findMany({ where: { equipoId } });
    },
    async create(data) {
        return database_1.prisma.ligaEquipo.create({ data });
    },
    async delete(ligaId, equipoId) {
        await database_1.prisma.ligaEquipo.delete({ where: { ligaId_equipoId: { ligaId, equipoId } } });
    },
};
//# sourceMappingURL=repository.js.map