"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findVisibleById: vitest_1.vi.fn(),
    findVisibleByDivision: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./repository', () => ({ premioRepository: mocks }));
vitest_1.vi.mock('../../config/database', () => ({ prisma: {} }));
const service_1 = require("./service");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
(0, vitest_1.describe)('premioService public reads', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('gets visible detail in one repository operation and preserves its shape', async () => {
        const premio = { id: 'premio-1', posicion: 1, divisionId: 'division-1' };
        mocks.findVisibleById.mockResolvedValue(premio);
        await (0, vitest_1.expect)(service_1.premioService.getById('premio-1', owner)).resolves.toBe(premio);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledWith('premio-1', owner);
    });
    (0, vitest_1.it)('returns 404 for a hidden or missing premio', async () => {
        mocks.findVisibleById.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.premioService.getById('premio-1')).rejects.toMatchObject({
            statusCode: 404,
            message: 'Premio no encontrado',
        });
    });
    (0, vitest_1.it)('returns an empty list for a visible division in one repository operation', async () => {
        mocks.findVisibleByDivision.mockResolvedValue([]);
        await (0, vitest_1.expect)(service_1.premioService.findByDivision('division-1', owner)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.findVisibleByDivision).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findVisibleByDivision).toHaveBeenCalledWith('division-1', owner);
    });
    (0, vitest_1.it)('returns 404 for a hidden or missing division', async () => {
        mocks.findVisibleByDivision.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.premioService.findByDivision('division-1')).rejects.toMatchObject({
            statusCode: 404,
            message: 'División no encontrado',
        });
    });
});
//# sourceMappingURL=service.test.js.map