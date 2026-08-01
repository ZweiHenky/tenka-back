"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tablaPosicionRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.tablaPosicionRouter = router;
router.get('/division/:divisionId', authMiddleware_1.optionalAuth, controller_1.tablaPosicionController.findByDivision);
router.get('/:divisionId/:equipoId', authMiddleware_1.optionalAuth, controller_1.tablaPosicionController.findOne);
router.use(authMiddleware_1.requireAuth);
router.post('/', controller_1.tablaPosicionController.upsert);
router.delete('/:divisionId/:equipoId', controller_1.tablaPosicionController.delete);
//# sourceMappingURL=routes.js.map