"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    jornadaFindFirst: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../../config/database', () => ({
    prisma: {
        jornada: {
            findFirst: mocks.jornadaFindFirst,
        },
    },
}));
vitest_1.vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vitest_1.vi.mock('../../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vitest_1.vi.mock('../../notification/service', () => ({ notificationService: {} }));
const repository_1 = require("../repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('jornada private contexts', () => {
    (0, vitest_1.it)('loads deletion authorization, latest ID, and repair fields in one narrow query', async () => {
        mocks.jornadaFindFirst.mockResolvedValue({
            divisionId: 'd-1',
            division: { ligaId: 'liga-1', liga: { userId: 'owner-1' }, jornadas: [{ id: 'j-2' }] },
            partidos: [
                { id: 'regular-final', estado: 'FINALIZADO', rondaPlayoffId: null, llave: null },
                { id: 'playoff', estado: 'PROGRAMADO', rondaPlayoffId: 'r-1', llave: 2 },
            ],
        });
        const result = await repository_1.jornadaRepository.findDeleteContext('j-2', owner);
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledWith({
            where: { id: 'j-2', division: { liga: { userId: 'owner-1' } } },
            select: {
                divisionId: true,
                division: {
                    select: {
                        ligaId: true,
                        liga: { select: { userId: true } },
                        jornadas: { orderBy: { numero: 'desc' }, take: 1, select: { id: true } },
                    },
                },
                partidos: {
                    where: {
                        OR: [
                            { estado: 'FINALIZADO' },
                            { rondaPlayoffId: { not: null }, llave: { not: null } },
                        ],
                    },
                    select: { id: true, estado: true, rondaPlayoffId: true, llave: true },
                },
            },
        });
        (0, vitest_1.expect)(result).toEqual({
            divisionId: 'd-1',
            ligaId: 'liga-1',
            ligaUserId: 'owner-1',
            latestJornadaId: 'j-2',
            hasFinalizados: true,
            playoffPartidos: [{ id: 'playoff', rondaPlayoffId: 'r-1', llave: 2 }],
        });
    });
    (0, vitest_1.it)('uses the supplied transaction client for the authoritative deletion context', async () => {
        const transactionFindFirst = vitest_1.vi.fn().mockResolvedValue(null);
        const tx = { jornada: { findFirst: transactionFindFirst } };
        await repository_1.jornadaRepository.findDeleteContext('j-2', owner, tx);
        (0, vitest_1.expect)(transactionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.jornadaFindFirst).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=private-context.test.js.map