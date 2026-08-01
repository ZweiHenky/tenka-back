"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipoController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.equipoController = {
    async list(req, res, next) {
        try {
            const { userId } = req.query;
            const data = userId ? await service_1.equipoService.listByUser(userId) : await service_1.equipoService.list();
            (0, response_1.ok)(res, data);
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.equipoService.getById(req.params.id));
        }
        catch (e) {
            next(e);
        }
    },
    async create(req, res, next) {
        try {
            const p = validator_1.createSchema.safeParse({ ...req.body, userId: req.user.id });
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            (0, response_1.created)(res, await service_1.equipoService.create(p.data), 'Equipo creado exitosamente');
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
            (0, response_1.ok)(res, await service_1.equipoService.update(req.params.id, p.data, req.user), 'Equipo actualizado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.equipoService.delete(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map