"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ getRecentSchedule: vitest_1.vi.fn() }));
vitest_1.vi.mock('./service', () => ({
    ligaService: { getRecentSchedule: mocks.getRecentSchedule },
}));
const controller_1 = require("./controller");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
(0, vitest_1.describe)('ligaController.getRecentSchedule', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('responde la programacion reciente con el envelope establecido', async () => {
        const schedule = { id: 'liga-1', nombre: 'Liga Centro', multiplesCanchas: false, divisiones: [] };
        mocks.getRecentSchedule.mockResolvedValue(schedule);
        const req = { params: { ligaId: 'liga-1' }, user: owner };
        const res = { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn() };
        const next = vitest_1.vi.fn();
        await controller_1.ligaController.getRecentSchedule(req, res, next);
        (0, vitest_1.expect)(mocks.getRecentSchedule).toHaveBeenCalledWith('liga-1', owner);
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: schedule });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=controller.test.js.map