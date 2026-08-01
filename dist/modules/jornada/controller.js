"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jornadaController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.jornadaController = {
    async list(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.jornadaService.list(req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.jornadaService.getById(req.params.id, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async findByDivision(req, res, next) {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
            const skip = (page - 1) * limit;
            (0, response_1.ok)(res, await service_1.jornadaService.findByDivision(req.params.divisionId, { skip, take: limit }, req.user));
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
            (0, response_1.created)(res, await service_1.jornadaService.create(p.data, req.user), 'Jornada creada exitosamente');
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
            (0, response_1.ok)(res, await service_1.jornadaService.update(req.params.id, p.data, req.user), 'Jornada actualizada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.jornadaService.delete(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async generateNext(req, res, next) {
        try {
            const jornada = await service_1.jornadaService.generateNext(req.params.divisionId, req.user, req.body.slots, req.body.equipoIds, req.body.descansoEquipoId);
            (0, response_1.created)(res, jornada, 'Jornada generada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map