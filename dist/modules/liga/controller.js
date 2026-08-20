"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const pagination_1 = require("../../utils/pagination");
function publicLiga(liga) {
    const { logoPublicId: _logo, canchaPublicId: _cover, ...safe } = liga;
    return safe;
}
exports.ligaController = {
    async list(req, res, next) {
        try {
            const { userId, page, limit, search, categoriaId, tipoId, estadoLigaId } = req.query;
            if (!userId) {
                const pagination = (0, pagination_1.parsePagination)(req.query);
                const result = await service_1.ligaService.listPaginated({
                    page: pagination.page,
                    limit: pagination.limit,
                    search: search,
                    categoriaId: categoriaId,
                    tipoId: tipoId,
                    estadoLigaId: estadoLigaId,
                });
                (0, response_1.ok)(res, { ...result, rows: result.rows.map(publicLiga) });
            }
            else {
                const ligas = await service_1.ligaService.listByUser(userId, req.user);
                (0, response_1.ok)(res, ligas.map(publicLiga));
            }
        }
        catch (err) {
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const liga = await service_1.ligaService.getById(req.params.id, req.user);
            (0, response_1.ok)(res, publicLiga(liga));
        }
        catch (err) {
            next(err);
        }
    },
    async create(req, res, next) {
        try {
            const parsed = validator_1.createLigaSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const liga = await service_1.ligaService.create({
                ...parsed.data,
                userId: req.user.id,
            });
            (0, response_1.created)(res, publicLiga(liga), 'Liga creada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async update(req, res, next) {
        try {
            const parsed = validator_1.updateLigaSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const liga = await service_1.ligaService.update(req.params.id, parsed.data, req.user);
            (0, response_1.ok)(res, publicLiga(liga), 'Liga actualizada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async delete(req, res, next) {
        try {
            const confirmName = typeof req.body?.confirmName === 'string' && req.body.confirmName.trim() ? req.body.confirmName : undefined;
            await service_1.ligaService.delete(req.params.id, req.user, confirmName);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
    async listCanchas(req, res, next) {
        try {
            const canchas = await service_1.ligaService.getCanchas(req.params.ligaId, req.user);
            (0, response_1.ok)(res, canchas);
        }
        catch (err) {
            next(err);
        }
    },
    async createCancha(req, res, next) {
        try {
            const parsed = validator_1.createCanchaSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const cancha = await service_1.ligaService.createCancha(req.params.ligaId, parsed.data, req.user);
            (0, response_1.created)(res, cancha, 'Cancha creada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async updateCancha(req, res, next) {
        try {
            const parsed = validator_1.updateCanchaSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const cancha = await service_1.ligaService.updateCancha(req.params.ligaId, req.params.canchaId, parsed.data, req.user);
            (0, response_1.ok)(res, cancha, 'Cancha actualizada exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async deleteCancha(req, res, next) {
        try {
            await service_1.ligaService.deleteCancha(req.params.ligaId, req.params.canchaId, req.user);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
    async listArbitros(req, res, next) {
        try {
            const arbitros = await service_1.ligaService.getArbitros(req.params.ligaId, req.user);
            (0, response_1.ok)(res, arbitros);
        }
        catch (err) {
            next(err);
        }
    },
    async getRecentSchedule(req, res, next) {
        try {
            const schedule = await service_1.ligaService.getRecentSchedule(req.params.ligaId, req.user);
            (0, response_1.ok)(res, schedule);
        }
        catch (err) {
            next(err);
        }
    },
    async createArbitro(req, res, next) {
        try {
            const parsed = validator_1.createArbitroSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const arbitro = await service_1.ligaService.createArbitro(req.params.ligaId, parsed.data, req.user);
            (0, response_1.created)(res, arbitro, 'Árbitro creado exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async updateArbitro(req, res, next) {
        try {
            const parsed = validator_1.updateArbitroSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const arbitro = await service_1.ligaService.updateArbitro(req.params.ligaId, req.params.arbitroId, parsed.data, req.user);
            (0, response_1.ok)(res, arbitro, 'Árbitro actualizado exitosamente');
        }
        catch (err) {
            next(err);
        }
    },
    async deleteArbitro(req, res, next) {
        try {
            await service_1.ligaService.deleteArbitro(req.params.ligaId, req.params.arbitroId, req.user);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=controller.js.map