"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disponibilidadCanchaRouter = void 0;
const express_1 = require("express");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const controller_1 = require("./controller");
const router = (0, express_1.Router)();
exports.disponibilidadCanchaRouter = router;
router.get('/:ligaId/disponibilidad-canchas', authMiddleware_1.requireAuth, controller_1.disponibilidadCanchaController.get);
//# sourceMappingURL=routes.js.map