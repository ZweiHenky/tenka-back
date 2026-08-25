import pino from 'pino';
import { env } from './env';

export const loggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: 'tenka-backend',
    environment: env.APP_ENV,
    release: env.SENTRY_RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers.set-cookie',
      '*.authorization',
      '*.cookie',
      '*.password',
      '*.secret',
      '*.token',
      '*.code',
      '*.otp',
      '*.email',
      '*.phoneNumber',
      '*.telefono',
      '*.DATABASE_URL',
    ],
    censor: '[REDACTED]',
  },
};

export const logger = pino(loggerOptions);
