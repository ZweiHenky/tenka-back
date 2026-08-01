"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ubicacionController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.ubicacionController = {
    async list(_req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.ubicacionService.list());
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.ubicacionService.getById(req.params.id));
        }
        catch (e) {
            next(e);
        }
    },
    async findOrCreate(req, res, next) {
        try {
            const p = validator_1.findOrCreateSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            (0, response_1.ok)(res, await service_1.ubicacionService.findOrCreate(p.data));
        }
        catch (e) {
            next(e);
        }
    },
    async create(req, res, next) {
        try {
            const p = validator_1.createSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            (0, response_1.created)(res, await service_1.ubicacionService.create(p.data), 'Ubicación creada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async update(req, res, next) {
        try {
            const p = validator_1.updateSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            (0, response_1.ok)(res, await service_1.ubicacionService.update(req.params.id, p.data), 'Ubicación actualizada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.ubicacionService.delete(req.params.id);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map