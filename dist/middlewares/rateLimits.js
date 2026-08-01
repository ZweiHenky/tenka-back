"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeWriteLimiter = exports.refereeReadLimiter = exports.uploadLimiter = exports.subscriptionLimiter = exports.otpVerifyLimiter = exports.otpSendLimiter = exports.authLimiter = exports.globalApiLimiter = void 0;
exports.createRateLimiter = createRateLimiter;
const express_rate_limit_1 = require("express-rate-limit");
const env_1 = require("../config/env");
const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo mas tarde.';
function createRateLimiter(options) {
    return (0, express_rate_limit_1.rateLimit)({
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({ success: false, error: RATE_LIMIT_MESSAGE, requestId: req.requestId });
        },
        ...options,
    });
}
exports.globalApiLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: env_1.env.GLOBAL_RATE_LIMIT });
exports.authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: env_1.env.AUTH_RATE_LIMIT });
exports.otpSendLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: env_1.env.OTP_SEND_RATE_LIMIT });
exports.otpVerifyLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: env_1.env.OTP_VERIFY_RATE_LIMIT });
exports.subscriptionLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: env_1.env.SUBSCRIPTION_RATE_LIMIT });
exports.uploadLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: env_1.env.UPLOAD_RATE_LIMIT,
    keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
});
exports.refereeReadLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 30 });
exports.refereeWriteLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });
//# sourceMappingURL=rateLimits.js.map