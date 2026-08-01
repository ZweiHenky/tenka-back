"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pino_1 = __importDefault(require("pino"));
const vitest_1 = require("vitest");
const logger_1 = require("./logger");
(0, vitest_1.describe)('logger redaction', () => {
    (0, vitest_1.it)('does not serialize authorization, cookie, token, OTP, or phone values', () => {
        let output = '';
        const destination = { write: (chunk) => { output += chunk; } };
        const testLogger = (0, pino_1.default)({ ...logger_1.loggerOptions, level: 'info' }, destination);
        const secrets = {
            authorization: 'Bearer authorization-secret',
            cookie: 'session=cookie-secret',
            setCookie: 'session=set-cookie-secret',
            token: 'token-secret',
            otp: '123456',
            phoneNumber: '+15551234567',
            telefono: '+525512345678',
        };
        testLogger.info({
            req: { headers: { authorization: secrets.authorization, cookie: secrets.cookie } },
            res: { headers: { 'set-cookie': secrets.setCookie } },
            auth: {
                authorization: secrets.authorization,
                cookie: secrets.cookie,
                token: secrets.token,
                otp: secrets.otp,
                phoneNumber: secrets.phoneNumber,
                telefono: secrets.telefono,
            },
        }, 'sensitive request');
        for (const secret of Object.values(secrets))
            (0, vitest_1.expect)(output).not.toContain(secret);
        (0, vitest_1.expect)(output.match(/\[REDACTED\]/g)?.length).toBe(9);
    });
});
//# sourceMappingURL=logger.test.js.map