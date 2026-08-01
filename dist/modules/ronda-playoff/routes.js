"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rondaPlayoffRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.rondaPlayoffRouter = router;
router.get('/', authMiddleware_1.optionalAuth, controller_1.rondaPlayoffController.list);
router.get('/division/:divisionId', authMiddleware_1.optionalAuth, controller_1.rondaPlayoffController.findByDivision);
router.get('/:id', authMiddleware_1.optionalAuth, controller_1.rondaPlayoffController.getById);
router.use(authMiddleware_1.requireAuth);
router.post('/', controller_1.rondaPlayoffController.create);
router.post('/generate', controller_1.rondaPlayoffController.generate);
router.patch('/:id', controller_1.rondaPlayoffController.update);
router.delete('/division/:divisionId', controller_1.rondaPlayoffController.deleteByDivision);
router.delete('/:id', controller_1.rondaPlayoffController.delete);
//# sourceMappingURL=routes.js.map