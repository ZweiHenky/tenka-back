"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const rateLimits_1 = require("./rateLimits");
function testApp(withUser) {
    const app = (0, express_1.default)();
    if (withUser) {
        app.use((req, _res, next) => {
            req.user = { id: req.get('x-user-id') ?? 'user-1', email: 'test@example.com', rol: 'LIGA' };
            next();
        });
    }
    app.get('/limited', (0, rateLimits_1.createRateLimiter)({ name: `test-${withUser}`, windowMs: 60000, limit: 1 }), (_req, res) => res.sendStatus(204));
    return app;
}
(0, vitest_1.describe)('rate-limit keys', () => {
    (0, vitest_1.it)('shares a bucket by authenticated user', async () => {
        const app = testApp(true);
        await (0, supertest_1.default)(app).get('/limited').set('x-user-id', 'user-1').expect(204);
        await (0, supertest_1.default)(app).get('/limited').set('x-user-id', 'user-1').expect(429);
        const requestFor = (id) => ({ user: { id }, ip: '127.0.0.1', socket: {} });
        (0, vitest_1.expect)((0, rateLimits_1.rateLimitActorKey)(requestFor('user-1'))).toBe('user:user-1');
        (0, vitest_1.expect)((0, rateLimits_1.rateLimitActorKey)(requestFor('user-2'))).toBe('user:user-2');
    });
    (0, vitest_1.it)('falls back to the client IP when no user is available', async () => {
        const app = testApp(false);
        await (0, supertest_1.default)(app).get('/limited').expect(204);
        const response = await (0, supertest_1.default)(app).get('/limited').expect(429);
        (0, vitest_1.expect)(response.body.error).toContain('Demasiadas solicitudes');
        (0, vitest_1.expect)((0, rateLimits_1.rateLimitActorKey)({ ip: '127.0.0.1', socket: {} })).toBe('ip:127.0.0.1');
    });
});
//# sourceMappingURL=rateLimits.test.js.map