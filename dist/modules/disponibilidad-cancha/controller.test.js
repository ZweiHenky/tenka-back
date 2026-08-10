"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errors_1 = require("../../utils/errors");
const mocks = vitest_1.vi.hoisted(() => ({ get: vitest_1.vi.fn() }));
vitest_1.vi.mock('./service', () => ({ disponibilidadCanchaService: { get: mocks.get } }));
const controller_1 = require("./controller");
const actor = { id: 'owner', email: 'owner@test.com', rol: 'LIGA' };
function response() {
    return { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn() };
}
(0, vitest_1.describe)('disponibilidadCanchaController', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('returns the standard envelope and parsed dates', async () => {
        const data = { ligaId: 'liga', mode: 'SINGLE' };
        mocks.get.mockResolvedValue(data);
        const req = {
            params: { ligaId: 'liga' },
            query: { inicio: '2026-08-01T00:00:00Z', fin: '2026-08-02T00:00:00Z' },
            user: actor,
        };
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.disponibilidadCanchaController.get(req, res, next);
        (0, vitest_1.expect)(mocks.get).toHaveBeenCalledWith('liga', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z'), actor);
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('forwards validation errors without invoking the service', async () => {
        const req = {
            params: { ligaId: 'liga' },
            query: { inicio: 'invalid', fin: '2026-08-02T00:00:00Z' },
            user: actor,
        };
        const next = vitest_1.vi.fn();
        await controller_1.disponibilidadCanchaController.get(req, response(), next);
        (0, vitest_1.expect)(mocks.get).not.toHaveBeenCalled();
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.any(errors_1.ValidationError));
    });
});
//# sourceMappingURL=controller.test.js.map