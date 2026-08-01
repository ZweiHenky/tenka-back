"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    rondaFindFirst: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        rondaPlayoff: { findFirst: mocks.rondaFindFirst },
        division: { findFirst: mocks.divisionFindFirst },
    },
}));
const repository_1 = require("./repository");
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
(0, vitest_1.describe)('rondaPlayoffRepository public reads', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('gets a round with embedded division visibility in one query', async () => {
        const ronda = { id: 'ronda-1', divisionId: 'division-1' };
        mocks.rondaFindFirst.mockResolvedValue(ronda);
        await (0, vitest_1.expect)(repository_1.rondaPlayoffRepository.findVisibleById('ronda-1', admin)).resolves.toBe(ronda);
        (0, vitest_1.expect)(mocks.rondaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.rondaFindFirst).toHaveBeenCalledWith({
            where: { id: 'ronda-1', division: {} },
        });
    });
    (0, vitest_1.it)('loads ordered rounds through one visible parent query', async () => {
        const partido = {
            id: 'partido-1',
            equipoLocal: { id: 'local-1', nombre: 'Local', logo: null },
            equipoVisitante: { id: 'visitante-1', nombre: 'Visitante', logo: null },
            cancha: { id: 'cancha-1', nombre: 'Central' },
            arbitros: [{ arbitro: { id: 'arbitro-1', nombre: 'Alex' } }],
        };
        const rondasPlayoff = [{ id: 'ronda-1', partidos: [partido] }, { id: 'ronda-2', partidos: [] }];
        mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff });
        await (0, vitest_1.expect)(repository_1.rondaPlayoffRepository.findVisibleByDivision('division-1')).resolves.toEqual([
            { id: 'ronda-1', partidos: [{ ...partido, arbitros: [{ id: 'arbitro-1', nombre: 'Alex' }] }] },
            { id: 'ronda-2', partidos: [] },
        ]);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: {
                id: 'division-1',
                estadoLiga: { nombre: { not: 'Borrador' } },
            },
            select: {
                rondasPlayoff: {
                    orderBy: { orden: 'asc' },
                    include: { partidos: { include: vitest_1.expect.any(Object) } },
                },
            },
        });
    });
    (0, vitest_1.it)('distinguishes a visible empty division from a hidden or missing division', async () => {
        mocks.divisionFindFirst.mockResolvedValueOnce({ rondasPlayoff: [] }).mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(repository_1.rondaPlayoffRepository.findVisibleByDivision('visible')).resolves.toEqual([]);
        await (0, vitest_1.expect)(repository_1.rondaPlayoffRepository.findVisibleByDivision('hidden-or-missing')).resolves.toBeNull();
    });
});
//# sourceMappingURL=repository.test.js.map