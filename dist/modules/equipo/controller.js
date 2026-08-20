"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipoController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const teamCode_1 = require("../../utils/teamCode");
const pagination_1 = require("../../utils/pagination");
function toTeamResponse(team, actorId) {
    const { logoPublicId: _logoPublicId, nombreNormalizado: _nombreNormalizado, userId, ...publicTeam } = team;
    return { ...publicTeam, codigo: (0, teamCode_1.getTeamCode)(team.id), esPropio: actorId === userId };
}
exports.equipoController = {
    async list(req, res, next) {
        try {
            const { userId } = req.query;
            if (userId) {
                const data = await service_1.equipoService.listByUser(userId);
                (0, response_1.ok)(res, data.map((team) => toTeamResponse(team, req.user?.id)));
                return;
            }
            const result = await service_1.equipoService.listPaginated((0, pagination_1.parsePagination)(req.query));
            (0, response_1.ok)(res, { ...result, rows: result.rows.map((team) => toTeamResponse(team, req.user?.id)) });
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            (0, response_1.ok)(res, toTeamResponse(await service_1.equipoService.getById(req.params.id), req.user?.id));
        }
        catch (e) {
            next(e);
        }
    },
    async create(req, res, next) {
        try {
            const p = validator_1.createSchema.safeParse({ ...req.body, userId: req.user.id });
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            (0, response_1.created)(res, toTeamResponse(await service_1.equipoService.create(p.data), req.user.id), 'Equipo creado exitosamente');
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
            (0, response_1.ok)(res, toTeamResponse(await service_1.equipoService.update(req.params.id, p.data, req.user), req.user.id), 'Equipo actualizado exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            const confirmName = typeof req.body?.confirmName === 'string' && req.body.confirmName.trim() ? req.body.confirmName : undefined;
            await service_1.equipoService.delete(req.params.id, req.user, confirmName);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map