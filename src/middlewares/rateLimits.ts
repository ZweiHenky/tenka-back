import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { env } from '../config/env';

const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo mas tarde.';

export function createRateLimiter(options: Partial<Options> & Pick<Options, 'limit' | 'windowMs'>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ success: false, error: RATE_LIMIT_MESSAGE, requestId: req.requestId });
    },
    ...options,
  });
}

export const globalApiLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: env.GLOBAL_RATE_LIMIT });
export const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT });
export const otpSendLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: env.OTP_SEND_RATE_LIMIT });
export const otpVerifyLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: env.OTP_VERIFY_RATE_LIMIT });
export const subscriptionLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: env.SUBSCRIPTION_RATE_LIMIT });
export const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: env.UPLOAD_RATE_LIMIT,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
});
export const refereeReadLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 30 });
export const refereeWriteLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 });
