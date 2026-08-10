"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jornadaRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.jornadaRouter = router;
router.get('/', authMiddleware_1.optionalAuth, controller_1.jornadaController.list);
router.get('/division/:divisionId', authMiddleware_1.optionalAuth, controller_1.jornadaController.findByDivision);
router.get('/:id', authMiddleware_1.optionalAuth, controller_1.jornadaController.getById);
router.use(authMiddleware_1.requireAuth);
router.post('/generate-next/:divisionId', controller_1.jornadaController.generateNext);
router.delete('/:id', controller_1.jornadaController.delete);
//# sourceMappingURL=routes.js.map