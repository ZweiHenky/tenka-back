"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    jornadaFindFirst: vitest_1.vi.fn(),
    jornadaFindMany: vitest_1.vi.fn(),
    jornadaCount: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../../config/database', () => ({
    prisma: {
        jornada: {
            findFirst: mocks.jornadaFindFirst,
            findMany: mocks.jornadaFindMany,
            count: mocks.jornadaCount,
        },
        division: { findFirst: mocks.divisionFindFirst },
    },
}));
const repository_1 = require("../repository");
const partido = {
    id: 'p-1',
    arbitros: [{ arbitro: { id: 'a-1', nombre: 'Arbitro Uno' } }],
};
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('jornadaRepository public reads', () => {
    (0, vitest_1.it)('loads visible detail and its full partido payload in one Prisma operation', async () => {
        mocks.jornadaFindFirst.mockResolvedValue({ id: 'j-1', divisionId: 'd-1', partidos: [partido] });
        const result = await repository_1.jornadaRepository.findVisibleById('j-1');
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledWith({
            where: {
                id: 'j-1',
                division: { estadoLiga: { nombre: { not: 'Borrador' } } },
            },
            include: {
                partidos: {
                    orderBy: { fecha: 'asc' },
                    include: {
                        equipoLocal: { select: { id: true, nombre: true, logo: true } },
                        equipoVisitante: { select: { id: true, nombre: true, logo: true } },
                        cancha: { select: { id: true, nombre: true } },
                        arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
                    },
                },
            },
        });
        (0, vitest_1.expect)(result?.partidos?.[0]).toMatchObject({
            id: 'p-1',
            arbitros: [{ id: 'a-1', nombre: 'Arbitro Uno' }],
        });
        (0, vitest_1.expect)(mocks.divisionFindFirst).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('selects paginated jornadas and total from one visible parent operation', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            jornadas: [{ id: 'j-2', divisionId: 'd-1', partidos: [partido] }],
            _count: { jornadas: 7 },
        });
        const result = await repository_1.jornadaRepository.findVisibleByDivision('d-1', { skip: 10, take: 10 });
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: {
                id: 'd-1',
                estadoLiga: { nombre: { not: 'Borrador' } },
            },
            select: vitest_1.expect.objectContaining({
                jornadas: vitest_1.expect.objectContaining({
                    orderBy: { numero: 'desc' },
                    skip: 10,
                    take: 10,
                }),
                _count: { select: { jornadas: true } },
            }),
        }));
        (0, vitest_1.expect)(result).toEqual({
            rows: [{ id: 'j-2', divisionId: 'd-1', partidos: [{ id: 'p-1', arbitros: [{ id: 'a-1', nombre: 'Arbitro Uno' }] }] }],
            total: 7,
        });
        (0, vitest_1.expect)(mocks.jornadaFindMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.jornadaCount).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.jornadaFindFirst).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=repository.read.test.js.map