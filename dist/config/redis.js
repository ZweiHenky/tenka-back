"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.connectRedis = connectRedis;
exports.disconnectRedis = disconnectRedis;
const redis_1 = require("redis");
const env_1 = require("./env");
const logger_1 = require("./logger");
exports.redis = (0, redis_1.createClient)({
    url: env_1.env.REDIS_URL,
    socket: {
        connectTimeout: env_1.env.PROVIDER_TIMEOUT_MS,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 5000),
    },
});
exports.redis.on('error', (error) => logger_1.logger.error({ event: 'redis.error', err: error }));
async function connectRedis() {
    if (exports.redis.isOpen)
        return;
    await exports.redis.connect();
    logger_1.logger.info({ event: 'redis.connected' });
}
async function disconnectRedis() {
    if (!exports.redis.isOpen)
        return;
    await exports.redis.close();
    logger_1.logger.info({ event: 'redis.disconnected' });
}
//# sourceMappingURL=redis.js.map