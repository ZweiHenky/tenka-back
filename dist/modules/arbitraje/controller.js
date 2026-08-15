"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arbitrajeController = void 0;
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const service_1 = require("./service");
const validator_1 = require("./validator");
const pagination_1 = require("../../utils/pagination");
const parse = (schema, value) => { const result = schema.safeParse(value); if (!result.success)
    throw new errors_1.ValidationError(result.error.issues[0].message); return result.data; };
const handle = (fn) => (req, res, next) => fn(req, res).catch(next);
exports.arbitrajeController = {
    list: handle(async (req, res) => (0, response_1.ok)(res, await service_1.arbitrajeService.list(req.params.ligaId, req.user))),
    detail: handle(async (req, res) => (0, response_1.ok)(res, await service_1.arbitrajeService.detail(req.params.ligaId, req.params.tandaId, req.user))),
    candidates: handle(async (req, res) => {
        const paginated = req.query.page !== undefined || req.query.limit !== undefined;
        const pagination = paginated ? (0, pagination_1.parsePagination)(req.query) : undefined;
        (0, response_1.ok)(res, await service_1.arbitrajeService.candidates(req.params.ligaId, req.user, pagination));
    }),
    removeAssignment: handle(async (req, res) => { await service_1.arbitrajeService.removeAssignment(req.params.ligaId, req.params.asignacionId, req.user); (0, response_1.noContent)(res); }),
    replaceLeagueAssignments: handle(async (req, res) => {
        const body = parse(validator_1.asignacionesLigaSchema, req.body);
        (0, response_1.ok)(res, await service_1.arbitrajeService.replaceLeagueAssignments(req.params.ligaId, req.user, body), 'Asignaciones de árbitros guardadas');
    }),
};
//# sourceMappingURL=controller.js.map