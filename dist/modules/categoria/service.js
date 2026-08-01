"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriaService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
exports.categoriaService = {
    async list() {
        return repository_1.categoriaRepository.findAll();
    },
    async getById(id) {
        const categoria = await repository_1.categoriaRepository.findById(id);
        if (!categoria)
            throw new errors_1.NotFoundError('Categoría');
        return categoria;
    },
    async create(data) {
        return repository_1.categoriaRepository.create(data);
    },
    async update(id, data) {
        await this.getById(id);
        return repository_1.categoriaRepository.update(id, data);
    },
    async delete(id) {
        await this.getById(id);
        await repository_1.categoriaRepository.delete(id);
    },
};
//# sourceMappingURL=service.js.map