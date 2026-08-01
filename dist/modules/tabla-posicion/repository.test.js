"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ divisionFindFirst: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        division: { findFirst: mocks.divisionFindFirst },
    },
}));
const repository_1 = require("./repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
(0, vitest_1.describe)('tablaPosicionRepository public reads', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    vitest_1.it.each([
        [undefined, { estadoLiga: { nombre: { not: 'Borrador' } } }],
        [owner, { OR: [
                    { estadoLiga: { nombre: { not: 'Borrador' } } },
                    { liga: { userId: owner.id } },
                ] }],
        [admin, {}],
    ])('selects standings and team summaries from one visible parent for actor %#', async (actor, visibility) => {
        mocks.divisionFindFirst.mockResolvedValue({ tablaPosiciones: [], equipos: [] });
        await repository_1.tablaPosicionRepository.findByDivision('division-1', actor);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', ...visibility },
            select: {
                tablaPosiciones: {
                    include: { equipo: { select: { id: true, nombre: true, logo: true } } },
                    orderBy: { puntos: 'desc' },
                },
                equipos: {
                    select: {
                        equipoId: true,
                        equipo: { select: { id: true, nombre: true, logo: true } },
                    },
                },
            },
        });
    });
    vitest_1.it.each([
        [undefined, { estadoLiga: { nombre: { not: 'Borrador' } } }],
        [owner, { OR: [
                    { estadoLiga: { nombre: { not: 'Borrador' } } },
                    { liga: { userId: owner.id } },
                ] }],
        [admin, {}],
    ])('selects one standing from one visible parent for actor %#', async (actor, visibility) => {
        mocks.divisionFindFirst.mockResolvedValue({ tablaPosiciones: [] });
        await repository_1.tablaPosicionRepository.findOne('division-1', 'team-1', actor);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', ...visibility },
            select: { tablaPosiciones: { where: { equipoId: 'team-1' } } },
        });
    });
});
//# sourceMappingURL=repository.test.js.map