"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaRouter = void 0;
const express_1 = require("express");
const authMiddleware_1 = require("../../middlewares/authMiddleware");
const controller_1 = require("./controller");
const rateLimits_1 = require("../../middlewares/rateLimits");
const router = (0, express_1.Router)();
exports.mediaRouter = router;
router.post('/sign-upload', authMiddleware_1.requireAuth, rateLimits_1.uploadLimiter, controller_1.mediaController.signUpload);
//# sourceMappingURL=routes.js.map