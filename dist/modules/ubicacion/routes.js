"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ubicacionRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.ubicacionRouter = router;
router.get('/', controller_1.ubicacionController.list);
router.get('/:id', controller_1.ubicacionController.getById);
router.use(authMiddleware_1.requireAuth);
router.post('/find-or-create', (0, authMiddleware_1.requireRole)('CAPITAN', 'LIGA'), controller_1.ubicacionController.findOrCreate);
router.post('/', (0, authMiddleware_1.requireRole)('CAPITAN', 'LIGA'), controller_1.ubicacionController.create);
router.patch('/:id', (0, authMiddleware_1.requireRole)('ADMINISTRADOR'), controller_1.ubicacionController.update);
router.delete('/:id', (0, authMiddleware_1.requireRole)('ADMINISTRADOR'), controller_1.ubicacionController.delete);
//# sourceMappingURL=routes.js.map