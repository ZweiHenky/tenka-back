"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const errors_1 = require("../utils/errors");
const errorHandler_1 = require("./errorHandler");
const requestContext_1 = require("./requestContext");
function createTestApp(error) {
    const app = (0, express_1.default)();
    app.use(requestContext_1.requestContext);
    app.get('/', () => {
        throw error;
    });
    app.use(errorHandler_1.errorHandler);
    return app;
}
(0, vitest_1.describe)('errorHandler', () => {
    (0, vitest_1.it)('returns a generic 500 with the request ID and no internal details', async () => {
        const response = await (0, supertest_1.default)(createTestApp(new Error('secret implementation detail')))
            .get('/')
            .set('x-request-id', 'request-500');
        (0, vitest_1.expect)(response.status).toBe(500);
        (0, vitest_1.expect)(response.body).toEqual({
            success: false,
            error: 'Error interno del servidor',
            requestId: 'request-500',
        });
        (0, vitest_1.expect)(JSON.stringify(response.body)).not.toContain('secret implementation detail');
        (0, vitest_1.expect)(response.body).not.toHaveProperty('stack');
    });
    (0, vitest_1.it)('uses an AppError status and safe message', async () => {
        const response = await (0, supertest_1.default)(createTestApp(new errors_1.AppError(422, 'Solicitud no procesable')))
            .get('/')
            .set('x-request-id', 'request-app-error');
        (0, vitest_1.expect)(response.status).toBe(422);
        (0, vitest_1.expect)(response.body).toEqual({
            success: false,
            error: 'Solicitud no procesable',
            requestId: 'request-app-error',
        });
    });
    vitest_1.it.each([
        [new errors_1.UnauthorizedError(), 401],
        [new errors_1.ForbiddenError(), 403],
        [new errors_1.NotFoundError('Ruta'), 404],
        [new errors_1.ConflictError('Recurso duplicado'), 409],
        [new errors_1.ValidationError('Datos invalidos'), 422],
    ])('normalizes %s as HTTP %s', async (error, status) => {
        const response = await (0, supertest_1.default)(createTestApp(error)).get('/').set('x-request-id', `request-${status}`);
        (0, vitest_1.expect)(response.status).toBe(status);
        (0, vitest_1.expect)(response.body).toMatchObject({ success: false, error: error.message, requestId: `request-${status}` });
    });
    (0, vitest_1.it)('normalizes malformed and oversized JSON bodies', async () => {
        const app = (0, express_1.default)();
        app.use(requestContext_1.requestContext);
        app.use(express_1.default.json({ limit: '10b' }));
        app.post('/', (_req, res) => res.sendStatus(204));
        app.use(errorHandler_1.errorHandler);
        const malformed = await (0, supertest_1.default)(app).post('/').set('content-type', 'application/json').send('{');
        (0, vitest_1.expect)(malformed.status).toBe(400);
        (0, vitest_1.expect)(malformed.body).toMatchObject({ success: false, error: 'JSON invalido' });
        const oversized = await (0, supertest_1.default)(app).post('/').send({ value: 'more-than-ten-bytes' });
        (0, vitest_1.expect)(oversized.status).toBe(413);
        (0, vitest_1.expect)(oversized.body).toMatchObject({ success: false, error: 'El cuerpo de la solicitud es demasiado grande' });
    });
});
//# sourceMappingURL=errorHandler.test.js.map