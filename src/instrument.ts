import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { env } from './config/env';

Sentry.init({
  dsn: env.SENTRY_DSN,
  enabled: Boolean(env.SENTRY_DSN),
  environment: env.APP_ENV,
  release: env.SENTRY_RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  tracesSampleRate: env.APP_ENV === 'local' ? 0 : 0.1,
  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      if (event.request.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.Authorization;
        delete event.request.headers.cookie;
        delete event.request.headers.Cookie;
      }
    }
    delete event.user;
    return event;
  },
});

export { Sentry };
