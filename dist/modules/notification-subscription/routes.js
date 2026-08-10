"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSubscriptionRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const rateLimits_1 = require("../../middlewares/rateLimits");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const router = (0, express_1.Router)();
exports.notificationSubscriptionRouter = router;
router.post('/subscribe', rateLimits_1.subscriptionLimiter, authMiddleware_1.optionalAuth, controller_1.notificationSubscriptionController.subscribe);
router.post('/unsubscribe', rateLimits_1.subscriptionLimiter, authMiddleware_1.optionalAuth, controller_1.notificationSubscriptionController.unsubscribe);
//# sourceMappingURL=routes.js.map