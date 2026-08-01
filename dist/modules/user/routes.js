"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const express_1 = require("express");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const controller_1 = require("./controller");
const router = (0, express_1.Router)();
exports.userRouter = router;
router.use(authMiddleware_1.requireAuth);
router.post('/me/activate-league-role', controller_1.userController.activateLeagueRole);
router.patch('/me', controller_1.userController.updateMe);
router.patch('/me/phone-visibility', controller_1.userController.updatePhoneVisibility);
//# sourceMappingURL=routes.js.map