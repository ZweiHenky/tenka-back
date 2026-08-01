"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const app_1 = require("./app");
const errorHandler_1 = require("./middlewares/errorHandler");
const rateLimits_1 = require("./middlewares/rateLimits");
const requestContext_1 = require("./middlewares/requestContext");
(0, vitest_1.describe)('API hardening', () => {
    const app = (0, app_1.createApp)();
    (0, vitest_1.it)('trusts exactly one proxy and sends security headers', async () => {
        (0, vitest_1.expect)(app.get('trust proxy')).toBe(1);
        const response = await (0, supertest_1.default)(app).get('/live');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.headers['x-content-type-options']).toBe('nosniff');
        (0, vitest_1.expect)(response.headers['x-frame-options']).toBe('SAMEORIGIN');
        (0, vitest_1.expect)(response.headers).not.toHaveProperty('x-powered-by');
    });
    (0, vitest_1.it)('allows configured browser origins and native requests without Origin', async () => {
        const browser = await (0, supertest_1.default)(app).get('/live').set('Origin', 'http://localhost:8081');
        (0, vitest_1.expect)(browser.status).toBe(200);
        (0, vitest_1.expect)(browser.headers['access-control-allow-origin']).toBe('http://localhost:8081');
        (0, vitest_1.expect)(browser.headers['access-control-allow-credentials']).toBe('true');
        const native = await (0, supertest_1.default)(app).get('/live');
        (0, vitest_1.expect)(native.status).toBe(200);
        (0, vitest_1.expect)(native.headers).not.toHaveProperty('access-control-allow-origin');
    });
    (0, vitest_1.it)('rejects browser origins outside the allowlist', async () => {
        const response = await (0, supertest_1.default)(app).get('/live').set('Origin', 'https://evil.example.com');
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body).toMatchObject({ success: false, error: 'Origen no permitido' });
        (0, vitest_1.expect)(response.body.requestId).toBeTypeOf('string');
    });
    (0, vitest_1.it)('keeps health probes outside API rate limits and normalizes unknown routes', async () => {
        const health = await (0, supertest_1.default)(app).get('/ready');
        (0, vitest_1.expect)(health.status).not.toBe(429);
        const missing = await (0, supertest_1.default)(app).get('/api/does-not-exist').set('x-request-id', 'request-404');
        (0, vitest_1.expect)(missing.status).toBe(404);
        (0, vitest_1.expect)(missing.body).toEqual({ success: false, error: 'Ruta no encontrado', requestId: 'request-404' });
    });
    (0, vitest_1.it)('returns a normalized 429 response', async () => {
        const limitedApp = (0, express_1.default)();
        limitedApp.set('trust proxy', 1);
        limitedApp.use(requestContext_1.requestContext);
        limitedApp.use((0, rateLimits_1.createRateLimiter)({ windowMs: 60000, limit: 1 }));
        limitedApp.get('/', (_req, res) => res.sendStatus(204));
        limitedApp.use(errorHandler_1.errorHandler);
        await (0, supertest_1.default)(limitedApp).get('/');
        const response = await (0, supertest_1.default)(limitedApp).get('/').set('x-request-id', 'request-429');
        (0, vitest_1.expect)(response.status).toBe(429);
        (0, vitest_1.expect)(response.body).toEqual({
            success: false,
            error: 'Demasiadas solicitudes. Intenta de nuevo mas tarde.',
            requestId: 'request-429',
        });
    });
});
//# sourceMappingURL=app.hardening.test.js.map