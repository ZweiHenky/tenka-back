"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estadoLigaRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.estadoLigaRouter = router;
router.get('/', controller_1.estadoLigaController.list);
router.get('/:id', controller_1.estadoLigaController.getById);
router.use(authMiddleware_1.requireAuth, (0, authMiddleware_1.requireRole)('ADMINISTRADOR'));
router.post('/', controller_1.estadoLigaController.create);
router.patch('/:id', controller_1.estadoLigaController.update);
router.delete('/:id', controller_1.estadoLigaController.delete);
//# sourceMappingURL=routes.js.map