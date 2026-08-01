"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rondaPlayoffController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.rondaPlayoffController = {
    async list(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.rondaPlayoffService.list(req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.rondaPlayoffService.getById(req.params.id, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async findByDivision(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.rondaPlayoffService.findByDivision(req.params.divisionId, req.user));
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
            (0, response_1.created)(res, await service_1.rondaPlayoffService.create(p.data, req.user), 'Ronda de playoff creada exitosamente');
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
            (0, response_1.ok)(res, await service_1.rondaPlayoffService.update(req.params.id, p.data, req.user), 'Ronda de playoff actualizada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.rondaPlayoffService.delete(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async deleteByDivision(req, res, next) {
        try {
            await service_1.rondaPlayoffService.deleteByDivision(req.params.divisionId, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async generate(req, res, next) {
        try {
            const p = validator_1.generateSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            const rondas = await service_1.rondaPlayoffService.generate(p.data.divisionId, p.data.cantidadEquipos, req.user);
            (0, response_1.created)(res, rondas, 'Llaves generadas exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map