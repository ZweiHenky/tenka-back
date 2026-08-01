"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estadoLigaService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
exports.estadoLigaService = {
    async list() {
        return repository_1.estadoLigaRepository.findAll();
    },
    async getById(id) {
        const t = await repository_1.estadoLigaRepository.findById(id);
        if (!t)
            throw new errors_1.NotFoundError('Estado de liga');
        return t;
    },
    async create(data) {
        return repository_1.estadoLigaRepository.create(data);
    },
    async update(id, data) {
        await this.getById(id);
        return repository_1.estadoLigaRepository.update(id, data);
    },
    async delete(id) {
        await this.getById(id);
        await repository_1.estadoLigaRepository.delete(id);
    },
};
//# sourceMappingURL=service.js.map