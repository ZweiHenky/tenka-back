"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tablaPosicionController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.tablaPosicionController = {
    async findByDivision(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.tablaPosicionService.findByDivision(req.params.divisionId, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async findOne(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.tablaPosicionService.findOne(req.params.divisionId, req.params.equipoId, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async upsert(req, res, next) {
        try {
            const p = validator_1.createSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            (0, response_1.ok)(res, await service_1.tablaPosicionService.upsert(p.data.divisionId, p.data.equipoId, p.data, req.user), 'Posición actualizada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.tablaPosicionService.delete(req.params.divisionId, req.params.equipoId, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map