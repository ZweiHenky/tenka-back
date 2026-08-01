"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tipoCompetenciaRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.tipoCompetenciaRouter = router;
router.get('/', controller_1.tipoCompetenciaController.list);
router.get('/:id', controller_1.tipoCompetenciaController.getById);
router.use(authMiddleware_1.requireAuth, (0, authMiddleware_1.requireRole)('ADMINISTRADOR'));
router.post('/', controller_1.tipoCompetenciaController.create);
router.patch('/:id', controller_1.tipoCompetenciaController.update);
router.delete('/:id', controller_1.tipoCompetenciaController.delete);
//# sourceMappingURL=routes.js.map