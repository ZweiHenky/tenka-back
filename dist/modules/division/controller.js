"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const pagination_1 = require("../../utils/pagination");
exports.divisionController = {
    async list(req, res, next) {
        try {
            const divisions = await service_1.divisionService.list((0, pagination_1.parsePagination)(req.query), req.user);
            (0, response_1.ok)(res, divisions);
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const division = await service_1.divisionService.getById(req.params.id, req.user);
            (0, response_1.ok)(res, division);
        }
        catch (err) {
            next(err);
        }
    },
    async listByLiga(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.divisionService.listByLiga(req.params.ligaId, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async create(req, res, next) {
        try {
            const parsed = validator_1.createDivisionSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const division = await service_1.divisionService.create({
                ...parsed.data,
                fechaInicio: parsed.data.fechaInicio ? new Date(parsed.data.fechaInicio) : undefined,
                fechaFin: parsed.data.fechaFin ? new Date(parsed.data.fechaFin) : undefined,
            }, req.user);
            (0, response_1.created)(res, division, 'Division creada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async update(req, res, next) {
        try {
            const parsed = validator_1.updateDivisionSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const division = await service_1.divisionService.update(req.params.id, {
                ...parsed.data,
                fechaInicio: parsed.data.fechaInicio ? new Date(parsed.data.fechaInicio) : undefined,
                fechaFin: parsed.data.fechaFin ? new Date(parsed.data.fechaFin) : undefined,
            }, req.user);
            (0, response_1.ok)(res, division, 'Division actualizada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.divisionService.delete(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
    async reset(req, res, next) {
        try {
            await service_1.divisionService.resetDivision(req.params.id, req.user);
            (0, response_1.ok)(res, undefined, 'Liga reiniciada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=controller.js.map