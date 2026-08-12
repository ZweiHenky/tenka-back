"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ubicacionService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
exports.ubicacionService = {
    async list() {
        return repository_1.ubicacionRepository.findAll();
    },
    async listPaginated(pagination) {
        return repository_1.ubicacionRepository.findAllPaginated(pagination);
    },
    async getById(id) {
        const t = await repository_1.ubicacionRepository.findById(id);
        if (!t)
            throw new errors_1.NotFoundError('Ubicación');
        return t;
    },
    async findOrCreate(data) {
        return repository_1.ubicacionRepository.findOrCreate(data);
    },
    async create(data) {
        return repository_1.ubicacionRepository.create(data);
    },
    async update(id, data) {
        await this.getById(id);
        return repository_1.ubicacionRepository.update(id, data);
    },
    async delete(id) {
        await this.getById(id);
        await repository_1.ubicacionRepository.delete(id);
    },
};
//# sourceMappingURL=service.js.map