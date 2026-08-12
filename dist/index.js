"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("./instrument");
const instrument_1 = require("./instrument");
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const database_1 = require("./config/database");
const readiness_1 = require("./config/readiness");
const cleanupWorkers_1 = require("./workers/cleanupWorkers");
const redis_1 = require("./config/redis");
let shuttingDown = false;
async function start() {
    await (0, redis_1.connectRedis)();
    const { default: app } = await Promise.resolve().then(() => __importStar(require('./app')));
    const server = app.listen(env_1.env.PORT, () => logger_1.logger.info({ event: 'server.started', port: env_1.env.PORT }));
    server.requestTimeout = env_1.env.HTTP_REQUEST_TIMEOUT_MS;
    server.headersTimeout = env_1.env.HTTP_HEADERS_TIMEOUT_MS;
    server.keepAliveTimeout = env_1.env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
    const stopWorkers = (0, cleanupWorkers_1.startCleanupWorkers)();
    async function shutdown(signal, exitCode = 0) {
        if (shuttingDown)
            return;
        shuttingDown = true;
        (0, readiness_1.markNotReady)();
        logger_1.logger.info({ event: 'server.shutdown.started', signal });
        const graceful = (async () => {
            await stopWorkers();
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            await (0, redis_1.disconnectRedis)();
            await database_1.prisma.$disconnect();
            await instrument_1.Sentry.close(2000);
        })();
        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('shutdown_timeout')), env_1.env.SHUTDOWN_GRACE_MS).unref();
        });
        try {
            await Promise.race([graceful, timeout]);
            logger_1.logger.info({ event: 'server.shutdown.completed' });
            process.exit(exitCode);
        }
        catch (error) {
            logger_1.logger.fatal({ event: 'server.shutdown.failed', err: error });
            await instrument_1.Sentry.close(1000);
            process.exit(1);
        }
    }
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('unhandledRejection', (error) => {
        instrument_1.Sentry.captureException(error);
        logger_1.logger.fatal({ event: 'process.unhandled_rejection', err: error });
        void shutdown('unhandledRejection', 1);
    });
    process.once('uncaughtException', (error) => {
        instrument_1.Sentry.captureException(error);
        logger_1.logger.fatal({ event: 'process.uncaught_exception', err: error });
        void shutdown('uncaughtException', 1);
    });
}
void start().catch(async (error) => {
    instrument_1.Sentry.captureException(error);
    logger_1.logger.fatal({ event: 'server.startup.failed', err: error });
    await instrument_1.Sentry.close(1000);
    process.exit(1);
});
//# sourceMappingURL=index.js.map