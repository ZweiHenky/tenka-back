"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jornadaController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const pagination_1 = require("../../utils/pagination");
exports.jornadaController = {
    async list(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.jornadaService.list((0, pagination_1.parsePagination)(req.query), req.user));
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
            const parsed = validator_1.generateNextSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const parsedKey = validator_1.idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
            if (!parsedKey.success)
                throw new errors_1.ValidationError(parsedKey.error.issues[0].message);
            const jornada = await service_1.jornadaService.generateNext(req.params.divisionId, req.user, parsed.data.slots, parsed.data.equipoIds, parsed.data.descansoEquipoId, parsedKey.data);
            const { idempotencyReplayed, ...response } = jornada;
            if (idempotencyReplayed)
                (0, response_1.ok)(res, response, 'Jornada generada previamente');
            else
                (0, response_1.created)(res, response, 'Jornada generada exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map