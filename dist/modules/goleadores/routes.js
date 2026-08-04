"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goleadoresRouter = void 0;
const express_1 = require("express");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const controller_1 = require("./controller");
const router = (0, express_1.Router)();
exports.goleadoresRouter = router;
router.get('/division/:divisionId', authMiddleware_1.optionalAuth, controller_1.goleadoresController.findByDivision);
//# sourceMappingURL=routes.js.map