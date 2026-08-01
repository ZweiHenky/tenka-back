"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
vitest_1.vi.mock('../config/database', () => ({
    prisma: { $queryRawUnsafe: vitest_1.vi.fn() },
}));
const health_1 = require("./health");
function createTestApp(overrides = {}) {
    const app = (0, express_1.default)();
    app.use((0, health_1.createHealthRouter)(overrides));
    return app;
}
(0, vitest_1.describe)('createHealthRouter', () => {
    (0, vitest_1.it)('reports the service as live', async () => {
        const response = await (0, supertest_1.default)(createTestApp()).get('/live');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toEqual({ status: 'ok' });
    });
    (0, vitest_1.it)('keeps the legacy health alias live', async () => {
        const response = await (0, supertest_1.default)(createTestApp()).get('/api/health');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toEqual({ status: 'ok' });
    });
    (0, vitest_1.it)('reports readiness after a successful database check', async () => {
        const checkDatabase = vitest_1.vi.fn().mockResolvedValue(undefined);
        const response = await (0, supertest_1.default)(createTestApp({ checkDatabase, isReady: () => true })).get('/ready');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body).toEqual({ status: 'ready' });
        (0, vitest_1.expect)(checkDatabase).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('returns 503 without database failure details', async () => {
        const response = await (0, supertest_1.default)(createTestApp({
            checkDatabase: () => Promise.reject(new Error('password exposed in database error')),
            isReady: () => true,
        })).get('/ready');
        (0, vitest_1.expect)(response.status).toBe(503);
        (0, vitest_1.expect)(response.body).toEqual({ status: 'not_ready', reason: 'database_error' });
        (0, vitest_1.expect)(JSON.stringify(response.body)).not.toContain('password exposed');
        (0, vitest_1.expect)(response.body).not.toHaveProperty('stack');
    });
    (0, vitest_1.it)('returns 503 when the database check times out', async () => {
        const response = await (0, supertest_1.default)(createTestApp({
            checkDatabase: () => new Promise(() => undefined),
            isReady: () => true,
            timeoutMs: 5,
        })).get('/ready');
        (0, vitest_1.expect)(response.status).toBe(503);
        (0, vitest_1.expect)(response.body).toEqual({ status: 'not_ready', reason: 'database_timeout' });
    });
    (0, vitest_1.it)('returns 503 without checking the database while shutting down', async () => {
        const checkDatabase = vitest_1.vi.fn().mockResolvedValue(undefined);
        const response = await (0, supertest_1.default)(createTestApp({ checkDatabase, isReady: () => false })).get('/ready');
        (0, vitest_1.expect)(response.status).toBe(503);
        (0, vitest_1.expect)(response.body).toEqual({ status: 'not_ready', reason: 'shutting_down' });
        (0, vitest_1.expect)(checkDatabase).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=health.test.js.map