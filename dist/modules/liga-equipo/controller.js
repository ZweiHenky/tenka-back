"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaEquipoController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.ligaEquipoController = {
    async findByLiga(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.ligaEquipoService.findByLiga(req.params.ligaId));
        }
        catch (e) {
            next(e);
        }
    },
    async findByEquipo(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.ligaEquipoService.findByEquipo(req.params.equipoId));
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
            (0, response_1.created)(res, await service_1.ligaEquipoService.create(p.data), 'Equipo asignado a liga exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.ligaEquipoService.delete(req.params.ligaId, req.params.equipoId);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map