"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriaService = void 0;
const errors_1 = require("../utils/errors");
const categoria_1 = require("../repositories/categoria");
exports.categoriaService = {
    async list() {
        return categoria_1.categoriaRepository.findAll();
    },
    async getById(id) {
        const categoria = await categoria_1.categoriaRepository.findById(id);
        if (!categoria)
            throw new errors_1.NotFoundError('Categoría');
        return categoria;
    },
    async create(data) {
        return categoria_1.categoriaRepository.create(data);
    },
    async update(id, data) {
        await this.getById(id);
        return categoria_1.categoriaRepository.update(id, data);
    },
    async delete(id) {
        await this.getById(id);
        await categoria_1.categoriaRepository.delete(id);
    },
};
//# sourceMappingURL=categoria.js.map