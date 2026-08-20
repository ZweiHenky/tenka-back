"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipoRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const rateLimits_1 = require("../../middlewares/rateLimits");
const router = (0, express_1.Router)();
exports.equipoRouter = router;
router.get('/', authMiddleware_1.optionalAuth, controller_1.equipoController.list);
router.get('/:id', authMiddleware_1.optionalAuth, controller_1.equipoController.getById);
router.use(authMiddleware_1.requireAuth);
router.post('/', (0, authMiddleware_1.requireRole)('CAPITAN', 'LIGA'), controller_1.equipoController.create);
router.patch('/:id', controller_1.equipoController.update);
router.delete('/:id', rateLimits_1.destructiveOperationLimiter, controller_1.equipoController.delete);
//# sourceMappingURL=routes.js.map