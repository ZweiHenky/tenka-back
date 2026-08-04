"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goleadoresController = void 0;
const response_1 = require("../../utils/response");
const service_1 = require("./service");
exports.goleadoresController = {
    async findByDivision(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.goleadoresService.findByDivision(req.params.divisionId, req.user));
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=controller.js.map