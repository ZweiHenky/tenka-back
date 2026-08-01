"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.loggerOptions = void 0;
const pino_1 = __importDefault(require("pino"));
const env_1 = require("./env");
exports.loggerOptions = {
    level: env_1.env.LOG_LEVEL,
    base: {
        service: 'tenka-backend',
        environment: env_1.env.APP_ENV,
        release: env_1.env.SENTRY_RELEASE ?? env_1.env.RAILWAY_GIT_COMMIT_SHA,
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
            '*.phoneNumber',
            '*.telefono',
            '*.DATABASE_URL',
        ],
        censor: '[REDACTED]',
    },
};
exports.logger = (0, pino_1.default)(exports.loggerOptions);
//# sourceMappingURL=logger.js.map