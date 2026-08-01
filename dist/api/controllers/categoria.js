"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriaController = void 0;
const categoria_1 = require("../../services/categoria");
const categoria_2 = require("../../validators/categoria");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
exports.categoriaController = {
    async list(_req, res, next) {
        try {
            const categorias = await categoria_1.categoriaService.list();
            (0, response_1.ok)(res, categorias);
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const categoria = await categoria_1.categoriaService.getById(req.params.id);
            (0, response_1.ok)(res, categoria);
        }
        catch (err) {
            next(err);
        }
    },
    async create(req, res, next) {
        try {
            const parsed = categoria_2.createCategoriaSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const categoria = await categoria_1.categoriaService.create(parsed.data);
            (0, response_1.created)(res, categoria);
        }
        catch (err) {
            next(err);
        }
    },
    async update(req, res, next) {
        try {
            const parsed = categoria_2.updateCategoriaSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const categoria = await categoria_1.categoriaService.update(req.params.id, parsed.data);
            (0, response_1.ok)(res, categoria);
        }
        catch (err) {
            next(err);
        }
    },
    async delete(req, res, next) {
        try {
            await categoria_1.categoriaService.delete(req.params.id);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=categoria.js.map