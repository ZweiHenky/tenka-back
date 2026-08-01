"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeAccessController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.refereeAccessController = {
    async createAccess(req, res, next) {
        try {
            const result = await service_1.refereeAccessService.createAccess(req.params.id, req.user);
            (0, response_1.created)(res, result, 'Enlace de árbitro generado');
        }
        catch (e) {
            next(e);
        }
    },
    async revokeAccess(req, res, next) {
        try {
            await service_1.refereeAccessService.revokeAccess(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async getLinkStatus(req, res, next) {
        try {
            const status = await service_1.refereeAccessService.getLinkStatus(req.params.id, req.user);
            (0, response_1.ok)(res, status);
        }
        catch (e) {
            next(e);
        }
    },
    async getPartidoByToken(req, res, next) {
        try {
            const data = await service_1.refereeAccessService.getPartidoByToken(req.headers.authorization);
            (0, response_1.ok)(res, data);
        }
        catch (e) {
            next(e);
        }
    },
    async updateResultByToken(req, res, next) {
        try {
            const p = validator_1.refereeResultSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            const data = await service_1.refereeAccessService.updateResultByToken(req.headers.authorization, p.data);
            (0, response_1.ok)(res, data, 'Resultado guardado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map