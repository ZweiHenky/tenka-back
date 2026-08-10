"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => {
    const requireRoleMiddleware = vitest_1.vi.fn((_req, _res, next) => next());
    return {
        requireAuth: vitest_1.vi.fn((_req, _res, next) => next()),
        requireRoleMiddleware,
        requireRole: vitest_1.vi.fn(() => requireRoleMiddleware),
        lookupLimiter: vitest_1.vi.fn((_req, _res, next) => next()),
        lookupByPhone: vitest_1.vi.fn(),
    };
});
vitest_1.vi.mock('../../middlewares/authMiddleware', () => ({
    optionalAuth: vitest_1.vi.fn((_req, _res, next) => next()),
    requireAuth: mocks.requireAuth,
    requireRole: mocks.requireRole,
}));
vitest_1.vi.mock('../../middlewares/rateLimits', () => ({
    playerPhoneLookupLimiter: mocks.lookupLimiter,
}));
vitest_1.vi.mock('./controller', () => ({
    jugadorController: {
        list: vitest_1.vi.fn(),
        getMe: vitest_1.vi.fn(),
        listDivisionsByPlayer: vitest_1.vi.fn(),
        listByDivisionTeam: vitest_1.vi.fn(),
        getById: vitest_1.vi.fn(),
        createMe: vitest_1.vi.fn(),
        updateMe: vitest_1.vi.fn(),
        lookupByPhone: mocks.lookupByPhone,
        create: vitest_1.vi.fn(),
        update: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
        assignToTeam: vitest_1.vi.fn(),
        removeFromTeam: vitest_1.vi.fn(),
        assignToDivision: vitest_1.vi.fn(),
        removeFromDivision: vitest_1.vi.fn(),
    },
}));
const routes_1 = require("./routes");
(0, vitest_1.describe)('jugador phone lookup route', () => {
    (0, vitest_1.it)('is mounted at the specific path with role authorization and its dedicated limiter', () => {
        const layer = routes_1.jugadorRouter.stack.find((entry) => entry.route?.path === '/equipo/:equipoId/buscar' && entry.route?.methods?.post);
        (0, vitest_1.expect)(layer).toBeDefined();
        (0, vitest_1.expect)(layer.route.stack.map((entry) => entry.handle)).toEqual([
            mocks.requireRoleMiddleware,
            mocks.lookupLimiter,
            mocks.lookupByPhone,
        ]);
        (0, vitest_1.expect)(mocks.requireRole).toHaveBeenCalledWith('CAPITAN', 'LIGA');
    });
});
//# sourceMappingURL=routes.test.js.map