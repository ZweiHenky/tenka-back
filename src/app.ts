import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { Sentry } from './instrument';
import { auth } from './auth';
import { logger } from './config/logger';
import { requestContext } from './middlewares/requestContext';
import { errorHandler } from './middlewares/errorHandler';
import { createHealthRouter } from './routes/health';
import { getCorsAllowedOrigins, env } from './config/env';
import { authLimiter, globalApiLimiter, otpSendLimiter, otpVerifyLimiter } from './middlewares/rateLimits';
import { AppError, ForbiddenError, NotFoundError } from './utils/errors';
import { categoriaRouter } from './modules/categoria/routes';
import { ligaRouter } from './modules/liga/routes';
import { tipoRouter } from './modules/tipo/routes';
import { ubicacionRouter } from './modules/ubicacion/routes';
import { estadoLigaRouter } from './modules/estado-liga/routes';
import { tipoCompetenciaRouter } from './modules/tipo-competencia/routes';
import { equipoRouter } from './modules/equipo/routes';
import { divisionRouter } from './modules/division/routes';
import { divisionEquipoRouter } from './modules/division-equipo/routes';
import { premioRouter } from './modules/premio/routes';
import { jornadaRouter } from './modules/jornada/routes';
import { rondaPlayoffRouter } from './modules/ronda-playoff/routes';
import { partidoRouter } from './modules/partido/routes';
import { tablaPosicionRouter } from './modules/tabla-posicion/routes';
import { userRouter } from './modules/user/routes';
import { jugadorRouter } from './modules/jugador/routes';
import { mediaRouter } from './modules/media/routes';
import { notificationSubscriptionRouter } from './modules/notification-subscription/routes';
import { refereeAccessRouter } from './modules/referee-access/routes';

export function createApp() {
  const app = express();
  const allowedOrigins = new Set(getCorsAllowedOrigins());

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      callback(new ForbiddenError('Origen no permitido'));
    },
  }));
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.requestId,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.URLENCODED_BODY_LIMIT }));
  app.use(createHealthRouter());
  app.use('/api', globalApiLimiter);

  const authHandler = toNodeHandler(auth);
  const runAuthHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(authHandler(req, res)).catch(next);
  };

  app.all('/api/auth/*', authLimiter, (req, res, next) => {
    if (/\/phone-number\/send-otp\/?$/.test(req.path)) return otpSendLimiter(req, res, () => runAuthHandler(req, res, next));
    if (/\/phone-number\/verify\/?$/.test(req.path)) return otpVerifyLimiter(req, res, () => runAuthHandler(req, res, next));
    runAuthHandler(req, res, next);
  });

  app.use('/api/categorias', categoriaRouter);
  app.use('/api/ligas', ligaRouter);
  app.use('/api/tipos', tipoRouter);
  app.use('/api/ubicaciones', ubicacionRouter);
  app.use('/api/estados-liga', estadoLigaRouter);
  app.use('/api/tipos-competencia', tipoCompetenciaRouter);
  app.use('/api/equipos', equipoRouter);
  app.use('/api/divisiones', divisionRouter);
  app.use('/api/divisiones-equipos', divisionEquipoRouter);
  app.use('/api/premios', premioRouter);
  app.use('/api/jornadas', jornadaRouter);
  app.use('/api/rondas-playoff', rondaPlayoffRouter);
  app.use('/api/partidos', partidoRouter);
  app.use('/api/tabla-posiciones', tablaPosicionRouter);
  app.use('/api/users', userRouter);
  app.use('/api/jugadores', jugadorRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/notification-subscriptions', notificationSubscriptionRouter);
  app.use('/api/referee', refereeAccessRouter);

  app.use((_req, _res, next) => next(new NotFoundError('Ruta')));

  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError: (error) => !(error instanceof AppError) && ((error as { status?: number }).status ?? 500) >= 500,
  });
  app.use(errorHandler);
  return app;
}

const app = createApp();
export default app;
