"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tipoController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.tipoController = {
    async list(_req, res, next) { try {
        (0, response_1.ok)(res, await service_1.tipoService.list());
    }
    catch (e) {
        next(e);
    } },
    async getById(req, res, next) { try {
        (0, response_1.ok)(res, await service_1.tipoService.getById(req.params.id));
    }
    catch (e) {
        next(e);
    } },
    async create(req, res, next) {
        try {
            const parsed = validator_1.createTipoSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            (0, response_1.created)(res, await service_1.tipoService.create(parsed.data), 'Tipo creado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async update(req, res, next) {
        try {
            const parsed = validator_1.updateTipoSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            (0, response_1.ok)(res, await service_1.tipoService.update(req.params.id, parsed.data), 'Tipo actualizado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) { try {
        await service_1.tipoService.delete(req.params.id);
        (0, response_1.noContent)(res);
    }
    catch (e) {
        next(e);
    } },
};
//# sourceMappingURL=controller.js.map