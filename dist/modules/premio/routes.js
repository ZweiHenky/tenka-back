"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.premioRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.premioRouter = router;
router.get('/', authMiddleware_1.optionalAuth, controller_1.premioController.list);
router.get('/division/:divisionId', authMiddleware_1.optionalAuth, controller_1.premioController.findByDivision);
router.get('/:id', authMiddleware_1.optionalAuth, controller_1.premioController.getById);
router.use(authMiddleware_1.requireAuth);
router.post('/', controller_1.premioController.create);
router.patch('/:id', controller_1.premioController.update);
router.delete('/:id', controller_1.premioController.delete);
//# sourceMappingURL=routes.js.map