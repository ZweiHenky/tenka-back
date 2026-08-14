"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const pino_http_1 = __importDefault(require("pino-http"));
const node_1 = require("better-auth/node");
const instrument_1 = require("./instrument");
const auth_1 = require("./auth");
const logger_1 = require("./config/logger");
const requestContext_1 = require("./middlewares/requestContext");
const errorHandler_1 = require("./middlewares/errorHandler");
const health_1 = require("./routes/health");
const env_1 = require("./config/env");
const rateLimits_1 = require("./middlewares/rateLimits");
const errors_1 = require("./utils/errors");
const routes_1 = require("./modules/categoria/routes");
const routes_2 = require("./modules/liga/routes");
const routes_3 = require("./modules/tipo/routes");
const routes_4 = require("./modules/ubicacion/routes");
const routes_5 = require("./modules/estado-liga/routes");
const routes_6 = require("./modules/tipo-competencia/routes");
const routes_7 = require("./modules/equipo/routes");
const routes_8 = require("./modules/division/routes");
const routes_9 = require("./modules/division-equipo/routes");
const routes_10 = require("./modules/premio/routes");
const routes_11 = require("./modules/jornada/routes");
const routes_12 = require("./modules/ronda-playoff/routes");
const routes_13 = require("./modules/partido/routes");
const routes_14 = require("./modules/tabla-posicion/routes");
const routes_15 = require("./modules/user/routes");
const routes_16 = require("./modules/jugador/routes");
const routes_17 = require("./modules/media/routes");
const routes_18 = require("./modules/notification-subscription/routes");
const routes_19 = require("./modules/referee-access/routes");
const routes_20 = require("./modules/disponibilidad-cancha/routes");
const routes_21 = require("./modules/goleadores/routes");
function createApp() {
    const app = (0, express_1.default)();
    const allowedOrigins = new Set((0, env_1.getCorsAllowedOrigins)());
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(requestContext_1.requestContext);
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({
        credentials: true,
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.has(origin))
                return callback(null, true);
            callback(new errors_1.ForbiddenError('Origen no permitido'));
        },
    }));
    app.use((0, pino_http_1.default)({
        logger: logger_1.logger,
        autoLogging: false,
        quietReqLogger: true,
        genReqId: (req) => req.requestId,
        serializers: {
            req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
            res: (res) => ({ statusCode: res.statusCode }),
        },
        customLogLevel: (_req, res, error) => {
            if (error || res.statusCode >= 500)
                return 'error';
            if (res.statusCode >= 400)
                return 'warn';
            return 'info';
        },
    }));
    app.use((req, res, next) => {
        const startedAt = process.hrtime.bigint();
        res.once('finish', () => {
            const routePath = req.route?.path;
            const route = typeof routePath === 'string' ? `${req.baseUrl}${routePath}` : 'unmatched';
            const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
            req.log[level]({
                event: 'http.request.completed',
                method: req.method,
                route,
                statusCode: res.statusCode,
                durationMs: Number(process.hrtime.bigint() - startedAt) / 1000000,
            });
        });
        next();
    });
    app.use(express_1.default.json({ limit: env_1.env.JSON_BODY_LIMIT }));
    app.use(express_1.default.urlencoded({ extended: false, limit: env_1.env.URLENCODED_BODY_LIMIT }));
    app.use((0, health_1.createHealthRouter)());
    app.use('/api', rateLimits_1.globalApiLimiter);
    const authHandler = (0, node_1.toNodeHandler)(auth_1.auth);
    const runAuthHandler = (req, res, next) => {
        Promise.resolve(authHandler(req, res)).catch(next);
    };
    app.all('/api/auth/*', rateLimits_1.authLimiter, (req, res, next) => {
        if (/\/phone-number\/send-otp\/?$/.test(req.path))
            return (0, rateLimits_1.otpSendLimiter)(req, res, () => runAuthHandler(req, res, next));
        if (/\/phone-number\/verify\/?$/.test(req.path))
            return (0, rateLimits_1.otpVerifyLimiter)(req, res, () => runAuthHandler(req, res, next));
        runAuthHandler(req, res, next);
    });
    app.use('/api/categorias', routes_1.categoriaRouter);
    app.use('/api/ligas', routes_20.disponibilidadCanchaRouter);
    app.use('/api/ligas', routes_2.ligaRouter);
    app.use('/api/tipos', routes_3.tipoRouter);
    app.use('/api/ubicaciones', routes_4.ubicacionRouter);
    app.use('/api/estados-liga', routes_5.estadoLigaRouter);
    app.use('/api/tipos-competencia', routes_6.tipoCompetenciaRouter);
    app.use('/api/equipos', routes_7.equipoRouter);
    app.use('/api/divisiones', routes_8.divisionRouter);
    app.use('/api/divisiones-equipos', routes_9.divisionEquipoRouter);
    app.use('/api/premios', routes_10.premioRouter);
    app.use('/api/jornadas', routes_11.jornadaRouter);
    app.use('/api/rondas-playoff', routes_12.rondaPlayoffRouter);
    app.use('/api/partidos', routes_13.partidoRouter);
    app.use('/api/tabla-posiciones', routes_14.tablaPosicionRouter);
    app.use('/api/users', routes_15.userRouter);
    app.use('/api/jugadores', routes_16.jugadorRouter);
    app.use('/api/media', routes_17.mediaRouter);
    app.use('/api/notification-subscriptions', routes_18.notificationSubscriptionRouter);
    app.use('/api/referee', routes_19.refereeAccessRouter);
    app.use('/api/goleadores', routes_21.goleadoresRouter);
    app.use((_req, _res, next) => next(new errors_1.NotFoundError('Ruta')));
    instrument_1.Sentry.setupExpressErrorHandler(app, {
        shouldHandleError: (error) => !(error instanceof errors_1.AppError) && (error.status ?? 500) >= 500,
    });
    app.use(errorHandler_1.errorHandler);
    return app;
}
const app = createApp();
exports.default = app;
//# sourceMappingURL=app.js.map