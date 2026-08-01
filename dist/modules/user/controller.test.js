"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ activateLeagueRole: vitest_1.vi.fn() }));
vitest_1.vi.mock('./service', () => ({
    userService: { activateLeagueRole: mocks.activateLeagueRole },
}));
vitest_1.vi.mock('../../config/database', () => ({ prisma: { user: {} } }));
vitest_1.vi.mock('../media/service', () => ({ mediaService: { scheduleImageCleanup: vitest_1.vi.fn() } }));
const controller_1 = require("./controller");
(0, vitest_1.describe)('userController.activateLeagueRole', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('uses only the authenticated user id and ignores body overrides', async () => {
        const user = { id: 'session-user', email: 'user@test.com', rol: 'LIGA' };
        mocks.activateLeagueRole.mockResolvedValue(user);
        const req = {
            user: { id: 'session-user', rol: 'CAPITAN' },
            body: { userId: 'other-user', id: 'other-user', rol: 'ADMINISTRADOR' },
        };
        const res = { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn() };
        const next = vitest_1.vi.fn();
        await controller_1.userController.activateLeagueRole(req, res, next);
        (0, vitest_1.expect)(mocks.activateLeagueRole).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.activateLeagueRole).toHaveBeenCalledWith('session-user');
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: user, message: 'Rol de liga activado' });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=controller.test.js.map