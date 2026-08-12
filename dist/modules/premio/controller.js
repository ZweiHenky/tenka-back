"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.premioController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const pagination_1 = require("../../utils/pagination");
exports.premioController = {
    async list(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.premioService.list((0, pagination_1.parsePagination)(req.query), req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.premioService.getById(req.params.id, req.user));
        }
        catch (e) {
            next(e);
        }
    },
    async findByDivision(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.premioService.findByDivision(req.params.divisionId, req.user));
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
            (0, response_1.created)(res, await service_1.premioService.create(p.data, req.user), 'Premio creado exitosamente');
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
            (0, response_1.ok)(res, await service_1.premioService.update(req.params.id, p.data, req.user), 'Premio actualizado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.premioService.delete(req.params.id, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map