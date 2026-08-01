"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const requestContext_1 = require("./requestContext");
function createTestApp() {
    const app = (0, express_1.default)();
    app.use(requestContext_1.requestContext);
    app.get('/', (req, res) => res.json({ requestId: req.requestId }));
    return app;
}
(0, vitest_1.describe)('requestContext', () => {
    (0, vitest_1.it)('preserves a valid incoming request ID', async () => {
        const requestId = 'client.request-123:retry_2';
        const response = await (0, supertest_1.default)(createTestApp()).get('/').set('x-request-id', requestId);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.headers['x-request-id']).toBe(requestId);
        (0, vitest_1.expect)(response.body).toEqual({ requestId });
    });
    (0, vitest_1.it)('generates a request ID for an invalid incoming value', async () => {
        const response = await (0, supertest_1.default)(createTestApp()).get('/').set('x-request-id', 'invalid request id');
        const generatedId = response.headers['x-request-id'];
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(generatedId).not.toBe('invalid request id');
        (0, vitest_1.expect)(generatedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        (0, vitest_1.expect)(response.body).toEqual({ requestId: generatedId });
    });
});
//# sourceMappingURL=requestContext.test.js.map