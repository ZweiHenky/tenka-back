"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    updateMany: vitest_1.vi.fn(),
    findUnique: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        user: {
            updateMany: mocks.updateMany,
            findUnique: mocks.findUnique,
        },
    },
}));
const service_1 = require("./service");
(0, vitest_1.describe)('userService.activateLeagueRole', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.updateMany.mockResolvedValue({ count: 1 });
    });
    vitest_1.it.each([
        ['CAPITAN', 'LIGA'],
        ['LIGA', 'LIGA'],
        ['ADMINISTRADOR', 'ADMINISTRADOR'],
    ])('transitions %s to %s without changing other roles', async (_initialRole, resultingRole) => {
        const user = { id: 'session-user', email: 'user@test.com', rol: resultingRole };
        mocks.findUnique.mockResolvedValue(user);
        await (0, vitest_1.expect)(service_1.userService.activateLeagueRole('session-user')).resolves.toEqual(user);
        (0, vitest_1.expect)(mocks.updateMany).toHaveBeenCalledWith({
            where: { id: 'session-user', rol: 'CAPITAN' },
            data: { rol: 'LIGA' },
        });
        (0, vitest_1.expect)(mocks.findUnique).toHaveBeenCalledWith({
            where: { id: 'session-user' },
            select: vitest_1.expect.not.objectContaining({ imagePublicId: true }),
        });
    });
});
//# sourceMappingURL=service.test.js.map