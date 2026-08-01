"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaEquipoService = void 0;
const repository_1 = require("./repository");
exports.ligaEquipoService = {
    async findByLiga(ligaId) {
        return repository_1.ligaEquipoRepository.findByLiga(ligaId);
    },
    async findByEquipo(equipoId) {
        return repository_1.ligaEquipoRepository.findByEquipo(equipoId);
    },
    async create(data) {
        return repository_1.ligaEquipoRepository.create(data);
    },
    async delete(ligaId, equipoId) {
        await repository_1.ligaEquipoRepository.delete(ligaId, equipoId);
    },
};
//# sourceMappingURL=service.js.map