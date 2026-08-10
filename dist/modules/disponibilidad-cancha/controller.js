"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disponibilidadCanchaController = void 0;
const errors_1 = require("../../utils/errors");
const response_1 = require("../../utils/response");
const service_1 = require("./service");
const validator_1 = require("./validator");
exports.disponibilidadCanchaController = {
    async get(req, res, next) {
        try {
            const parsed = validator_1.availabilityRangeSchema.safeParse(req.query);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            (0, response_1.ok)(res, await service_1.disponibilidadCanchaService.get(req.params.ligaId, parsed.data.inicio, parsed.data.fin, req.user));
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=controller.js.map