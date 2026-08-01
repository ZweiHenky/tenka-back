"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    jornadaFindFirst: vitest_1.vi.fn(),
    jornadaUpdate: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../../config/database', () => ({
    prisma: {
        jornada: {
            findFirst: mocks.jornadaFindFirst,
            update: mocks.jornadaUpdate,
        },
    },
}));
vitest_1.vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vitest_1.vi.mock('../../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vitest_1.vi.mock('../../notification/service', () => ({ notificationService: {} }));
const repository_1 = require("../repository");
const service_1 = require("../service");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('jornada private contexts', () => {
    (0, vitest_1.it)('updates with one narrow authorization query and preserves the update response', async () => {
        const updated = { id: 'j-1', numero: 4, divisionId: 'd-1' };
        mocks.jornadaFindFirst.mockResolvedValue({ id: 'j-1' });
        mocks.jornadaUpdate.mockResolvedValue(updated);
        await (0, vitest_1.expect)(service_1.jornadaService.update('j-1', { numero: 4 }, owner)).resolves.toBe(updated);
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledWith({
            where: { id: 'j-1', division: { liga: { userId: 'owner-1' } } },
            select: { id: true },
        });
        (0, vitest_1.expect)(mocks.jornadaUpdate).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('returns 404 and does not update when ownership filtering finds no jornada', async () => {
        mocks.jornadaFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.jornadaService.update('hidden', { numero: 4 }, owner)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.jornadaUpdate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('allows an admin context lookup without an owner predicate', async () => {
        mocks.jornadaFindFirst.mockResolvedValue({ id: 'j-1' });
        await repository_1.jornadaRepository.findUpdateContext('j-1', admin);
        (0, vitest_1.expect)(mocks.jornadaFindFirst).toHaveBeenCalledWith({
            where: { id: 'j-1' },
            select: { id: true },
        });
    });
    (0, vitest_1.it)('loads deletion authorization, latest ID, and repair fields in one narrow query', async () => {
        mocks.jornadaFindFirst.mockResolvedValue({
            divisionId: 'd-1',
            division: { jornadas: [{ id: 'j-2' }] },
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
            latestJornadaId: 'j-2',
            hasFinalizados: true,
            playoffPartidos: [{ id: 'playoff', rondaPlayoffId: 'r-1', llave: 2 }],
        });
    });
});
//# sourceMappingURL=private-context.test.js.map