import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env';
import { redis } from '../config/redis';

const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo mas tarde.';

type RateLimiterOptions = Partial<Options> & Pick<Options, 'limit' | 'windowMs'> & { name?: string };

export const rateLimitActorKey = (req: Pick<Request, 'user' | 'ip' | 'socket'>): string => req.user?.id
  ? `user:${req.user.id}`
  : `ip:${ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown')}`;
const actorKey: NonNullable<Options['keyGenerator']> = (req) => rateLimitActorKey(req);

export function createRateLimiter({ name = 'custom', ...options }: RateLimiterOptions) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ success: false, error: RATE_LIMIT_MESSAGE, requestId: req.requestId });
    },
    store: env.NODE_ENV === 'test' ? undefined : new RedisStore({
      prefix: `rate-limit:${name}:`,
      sendCommand: (...args: string[]) => redis.sendCommand(args),
    }),
    ...options,
  });
}

export const globalApiLimiter = createRateLimiter({ name: 'global', windowMs: 15 * 60 * 1000, limit: env.GLOBAL_RATE_LIMIT });
export const authLimiter = createRateLimiter({ name: 'auth', windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT });
export const otpSendLimiter = createRateLimiter({ name: 'otp-send', windowMs: 10 * 60 * 1000, limit: env.OTP_SEND_RATE_LIMIT });
export const otpVerifyLimiter = createRateLimiter({ name: 'otp-verify', windowMs: 10 * 60 * 1000, limit: env.OTP_VERIFY_RATE_LIMIT });
export const subscriptionLimiter = createRateLimiter({ name: 'subscription', windowMs: 15 * 60 * 1000, limit: env.SUBSCRIPTION_RATE_LIMIT });
export const uploadLimiter = createRateLimiter({
  name: 'upload',
  windowMs: 15 * 60 * 1000,
  limit: env.UPLOAD_RATE_LIMIT,
  keyGenerator: actorKey,
});
export const playerPhoneLookupLimiter = createRateLimiter({
  name: 'player-phone-lookup',
  windowMs: 10 * 60 * 1000,
  limit: env.PLAYER_PHONE_LOOKUP_RATE_LIMIT,
  keyGenerator: actorKey,
});
export const refereeReadLimiter = createRateLimiter({ name: 'referee-read', windowMs: 15 * 60 * 1000, limit: env.REFEREE_READ_RATE_LIMIT });
export const refereeWriteLimiter = createRateLimiter({ name: 'referee-write', windowMs: 15 * 60 * 1000, limit: 5 });
export const waitlistLimiter = createRateLimiter({
  name: 'waitlist',
  windowMs: env.WAITLIST_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: env.WAITLIST_RATE_LIMIT,
});
export const jornadaGenerationLimiter = createRateLimiter({
  name: 'jornada-generation',
  windowMs: env.JORNADA_GENERATION_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: env.JORNADA_GENERATION_RATE_LIMIT,
  keyGenerator: actorKey,
});
export const playoffGenerationLimiter = createRateLimiter({
  name: 'playoff-generation',
  windowMs: env.PLAYOFF_GENERATION_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: env.PLAYOFF_GENERATION_RATE_LIMIT,
  keyGenerator: actorKey,
});
export const destructiveOperationLimiter = createRateLimiter({
  name: 'destructive-operation',
  windowMs: env.DESTRUCTIVE_OPERATION_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: env.DESTRUCTIVE_OPERATION_RATE_LIMIT,
  keyGenerator: actorKey,
});
