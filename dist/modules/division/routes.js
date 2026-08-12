"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const rateLimits_1 = require("../../middlewares/rateLimits");
const router = (0, express_1.Router)();
exports.divisionRouter = router;
router.get('/', authMiddleware_1.optionalAuth, controller_1.divisionController.list);
router.get('/por-liga/:ligaId', authMiddleware_1.optionalAuth, controller_1.divisionController.listByLiga);
router.get('/:id', authMiddleware_1.optionalAuth, controller_1.divisionController.getById);
router.use(authMiddleware_1.requireAuth);
router.post('/', controller_1.divisionController.create);
router.patch('/:id', controller_1.divisionController.update);
router.delete('/:id', rateLimits_1.expensiveOperationLimiter, controller_1.divisionController.delete);
router.post('/:id/reset', rateLimits_1.expensiveOperationLimiter, controller_1.divisionController.reset);
//# sourceMappingURL=routes.js.map