"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partidoController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const service_2 = require("../referee-access/service");
exports.partidoController = {
    async list(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.partidoService.list(req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.partidoService.getById(req.params.id, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async findByJornada(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.partidoService.findByJornada(req.params.jornadaId, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async findByRondaPlayoff(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.partidoService.findByRondaPlayoff(req.params.rondaPlayoffId, req.user));
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
            (0, response_1.created)(res, await service_1.partidoService.create(p.data, req.user), 'Partido creado exitosamente');
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
            const updated = await service_1.partidoService.update(req.params.id, p.data, req.user);
            (0, response_1.ok)(res, updated, 'Partido actualizado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.partidoService.delete(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async getRefereeLinkStatus(req, res, next) {
        try {
            const status = await service_2.refereeAccessService.getLinkStatus(req.params.id, req.user);
            (0, response_1.ok)(res, status);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map