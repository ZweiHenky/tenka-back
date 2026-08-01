"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tipoService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
exports.tipoService = {
    async list() { return repository_1.tipoRepository.findAll(); },
    async getById(id) { const t = await repository_1.tipoRepository.findById(id); if (!t)
        throw new errors_1.NotFoundError('Tipo'); return t; },
    async create(data) { return repository_1.tipoRepository.create(data); },
    async update(id, data) { await this.getById(id); return repository_1.tipoRepository.update(id, data); },
    async delete(id) { await this.getById(id); await repository_1.tipoRepository.delete(id); },
};
//# sourceMappingURL=service.js.map