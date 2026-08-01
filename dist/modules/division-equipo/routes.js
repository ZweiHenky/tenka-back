"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionEquipoRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.divisionEquipoRouter = router;
router.get('/division/:divisionId', authMiddleware_1.optionalAuth, controller_1.divisionEquipoController.findByDivision);
router.get('/equipo/:equipoId', authMiddleware_1.optionalAuth, controller_1.divisionEquipoController.findByEquipo);
router.use(authMiddleware_1.requireAuth);
router.post('/', controller_1.divisionEquipoController.create);
router.patch('/:divisionId/:equipoId', controller_1.divisionEquipoController.updateSaldoPendiente);
router.delete('/:divisionId/:equipoId', controller_1.divisionEquipoController.delete);
//# sourceMappingURL=routes.js.map