"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expensiveOperationLimiter = exports.refereeWriteLimiter = exports.refereeReadLimiter = exports.playerPhoneLookupLimiter = exports.uploadLimiter = exports.subscriptionLimiter = exports.otpVerifyLimiter = exports.otpSendLimiter = exports.authLimiter = exports.globalApiLimiter = exports.rateLimitActorKey = void 0;
exports.createRateLimiter = createRateLimiter;
const express_rate_limit_1 = require("express-rate-limit");
const rate_limit_redis_1 = require("rate-limit-redis");
const env_1 = require("../config/env");
const redis_1 = require("../config/redis");
const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo mas tarde.';
const rateLimitActorKey = (req) => req.user?.id
    ? `user:${req.user.id}`
    : `ip:${(0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? req.socket.remoteAddress ?? 'unknown')}`;
exports.rateLimitActorKey = rateLimitActorKey;
const actorKey = (req) => (0, exports.rateLimitActorKey)(req);
function createRateLimiter({ name = 'custom', ...options }) {
    return (0, express_rate_limit_1.rateLimit)({
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({ success: false, error: RATE_LIMIT_MESSAGE, requestId: req.requestId });
        },
        store: env_1.env.NODE_ENV === 'test' ? undefined : new rate_limit_redis_1.RedisStore({
            prefix: `rate-limit:${name}:`,
            sendCommand: (...args) => redis_1.redis.sendCommand(args),
        }),
        ...options,
    });
}
exports.globalApiLimiter = createRateLimiter({ name: 'global', windowMs: 15 * 60 * 1000, limit: env_1.env.GLOBAL_RATE_LIMIT });
exports.authLimiter = createRateLimiter({ name: 'auth', windowMs: 15 * 60 * 1000, limit: env_1.env.AUTH_RATE_LIMIT });
exports.otpSendLimiter = createRateLimiter({ name: 'otp-send', windowMs: 10 * 60 * 1000, limit: env_1.env.OTP_SEND_RATE_LIMIT });
exports.otpVerifyLimiter = createRateLimiter({ name: 'otp-verify', windowMs: 10 * 60 * 1000, limit: env_1.env.OTP_VERIFY_RATE_LIMIT });
exports.subscriptionLimiter = createRateLimiter({ name: 'subscription', windowMs: 15 * 60 * 1000, limit: env_1.env.SUBSCRIPTION_RATE_LIMIT });
exports.uploadLimiter = createRateLimiter({
    name: 'upload',
    windowMs: 15 * 60 * 1000,
    limit: env_1.env.UPLOAD_RATE_LIMIT,
    keyGenerator: actorKey,
});
exports.playerPhoneLookupLimiter = createRateLimiter({
    name: 'player-phone-lookup',
    windowMs: 10 * 60 * 1000,
    limit: env_1.env.PLAYER_PHONE_LOOKUP_RATE_LIMIT,
    keyGenerator: actorKey,
});
exports.refereeReadLimiter = createRateLimiter({ name: 'referee-read', windowMs: 15 * 60 * 1000, limit: env_1.env.REFEREE_READ_RATE_LIMIT });
exports.refereeWriteLimiter = createRateLimiter({ name: 'referee-write', windowMs: 15 * 60 * 1000, limit: 5 });
exports.expensiveOperationLimiter = createRateLimiter({
    name: 'expensive-operation',
    windowMs: 60 * 60 * 1000,
    limit: env_1.env.EXPENSIVE_OPERATION_RATE_LIMIT,
    keyGenerator: actorKey,
});
//# sourceMappingURL=rateLimits.js.map