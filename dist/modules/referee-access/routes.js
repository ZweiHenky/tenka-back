"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeAccessRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const rateLimits_1 = require("../../middlewares/rateLimits");
const router = (0, express_1.Router)();
exports.refereeAccessRouter = router;
router.get('/partido', rateLimits_1.refereeReadLimiter, controller_1.refereeAccessController.getPartidoByToken);
router.patch('/partido/result', rateLimits_1.refereeWriteLimiter, controller_1.refereeAccessController.updateResultByToken);
//# sourceMappingURL=routes.js.map