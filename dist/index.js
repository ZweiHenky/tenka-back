"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./instrument");
const app_1 = __importDefault(require("./app"));
const instrument_1 = require("./instrument");
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const database_1 = require("./config/database");
const readiness_1 = require("./config/readiness");
const cleanupWorkers_1 = require("./workers/cleanupWorkers");
const server = app_1.default.listen(env_1.env.PORT, () => logger_1.logger.info({ event: 'server.started', port: env_1.env.PORT }));
server.requestTimeout = env_1.env.HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = env_1.env.HTTP_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env_1.env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
const stopWorkers = (0, cleanupWorkers_1.startCleanupWorkers)();
let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    (0, readiness_1.markNotReady)();
    logger_1.logger.info({ event: 'server.shutdown.started', signal });
    const graceful = (async () => {
        await stopWorkers();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
exports.default = app_1.default;
//# sourceMappingURL=index.js.map