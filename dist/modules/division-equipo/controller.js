"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionEquipoController = void 0;
const service_1 = require("./service");
const validator_1 = require("./validator");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const teamCode_1 = require("../../utils/teamCode");
exports.divisionEquipoController = {
    async findByDivision(req, res, next) {
        try {
            const links = await service_1.divisionEquipoService.findByDivision(req.params.divisionId, req.user);
            (0, response_1.ok)(res, links.map(({ equipo, ...link }) => ({
                ...link,
                ...(equipo ? {
                    equipo: {
                        id: equipo.id,
                        nombre: equipo.nombre,
                        logo: equipo.logo,
                        codigo: (0, teamCode_1.getTeamCode)(equipo.id),
                        esPropio: req.user?.id === equipo.userId,
                    },
                } : {}),
            })));
        }
        catch (e) {
            next(e);
        }
    },
    async findByEquipo(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.divisionEquipoService.findByEquipo(req.params.equipoId, req.user));
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
            (0, response_1.created)(res, await service_1.divisionEquipoService.create(p.data, req.user), 'Equipo asignado a division exitosamente');
        }
        catch (e) {
            next(e);
        }
    },
    async updateSaldoPendiente(req, res, next) {
        try {
            const parsed = validator_1.updateSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const result = await service_1.divisionEquipoService.updateSaldoPendiente(req.params.divisionId, req.params.equipoId, parsed.data.saldoPendiente, req.user);
            (0, response_1.ok)(res, result, 'Saldo pendiente actualizado');
        }
        catch (e) {
            next(e);
        }
    },
    async delete(req, res, next) {
        try {
            await service_1.divisionEquipoService.delete(req.params.divisionId, req.params.equipoId, req.user);
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map