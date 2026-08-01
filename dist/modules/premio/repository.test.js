"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    premioFindFirst: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        premio: { findFirst: mocks.premioFindFirst },
        division: { findFirst: mocks.divisionFindFirst },
    },
}));
const repository_1 = require("./repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
(0, vitest_1.describe)('premioRepository public reads', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('gets a premio with embedded division visibility in one query', async () => {
        const premio = { id: 'premio-1', divisionId: 'division-1' };
        mocks.premioFindFirst.mockResolvedValue(premio);
        await (0, vitest_1.expect)(repository_1.premioRepository.findVisibleById('premio-1', owner)).resolves.toBe(premio);
        (0, vitest_1.expect)(mocks.premioFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.premioFindFirst).toHaveBeenCalledWith({
            where: {
                id: 'premio-1',
                division: { OR: [
                        { estadoLiga: { nombre: { not: 'Borrador' } } },
                        { liga: { userId: owner.id } },
                    ] },
            },
        });
    });
    (0, vitest_1.it)('loads ordered premios through one visible parent query', async () => {
        const premios = [{ id: 'premio-1' }, { id: 'premio-2' }];
        mocks.divisionFindFirst.mockResolvedValue({ premios });
        await (0, vitest_1.expect)(repository_1.premioRepository.findVisibleByDivision('division-1')).resolves.toBe(premios);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: {
                id: 'division-1',
                estadoLiga: { nombre: { not: 'Borrador' } },
            },
            select: { premios: { orderBy: { posicion: 'asc' } } },
        });
    });
    (0, vitest_1.it)('distinguishes a visible empty division from a hidden or missing division', async () => {
        mocks.divisionFindFirst.mockResolvedValueOnce({ premios: [] }).mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(repository_1.premioRepository.findVisibleByDivision('visible')).resolves.toEqual([]);
        await (0, vitest_1.expect)(repository_1.premioRepository.findVisibleByDivision('hidden-or-missing')).resolves.toBeNull();
    });
});
//# sourceMappingURL=repository.test.js.map