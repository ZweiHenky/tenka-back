"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ ligaFindFirst: vitest_1.vi.fn(), partidoFindMany: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        liga: { findFirst: mocks.ligaFindFirst },
        partido: { findMany: mocks.partidoFindMany },
    },
}));
const repository_1 = require("./repository");
const owner = { id: 'owner', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const inicio = new Date('2026-08-01T00:00:00.000Z');
const fin = new Date('2026-08-02T00:00:00.000Z');
(0, vitest_1.describe)('disponibilidadCanchaRepository', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    vitest_1.it.each([
        ['owner', owner, { id: 'liga-1', userId: 'owner' }],
        ['admin', admin, { id: 'liga-1' }],
    ])('loads only active courts with %s authorization in one narrow query', async (_label, actor, where) => {
        mocks.ligaFindFirst.mockResolvedValue(null);
        await repository_1.disponibilidadCanchaRepository.findLeagueContext('liga-1', actor);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith({
            where,
            select: {
                id: true,
                multiplesCanchas: true,
                canchas: {
                    where: { activa: true },
                    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
                    select: { id: true, nombre: true },
                },
            },
        });
    });
    (0, vitest_1.it)('queries half-open occupancy through jornada and playoff divisions and projects context', async () => {
        mocks.partidoFindMany.mockResolvedValue([
            { id: 'regular', fecha: inicio, fechaFin: fin, canchaId: 'a', jornada: { division: { id: 'd1', nombre: 'Uno' } }, rondaPlayoff: null },
            { id: 'playoff', fecha: inicio, fechaFin: fin, canchaId: null, jornada: null, rondaPlayoff: { division: { id: 'd2', nombre: 'Dos' } } },
        ]);
        const result = await repository_1.disponibilidadCanchaRepository.findOccupancy('liga-1', inicio, fin);
        (0, vitest_1.expect)(mocks.partidoFindMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: {
                fecha: { lt: fin },
                fechaFin: { gt: inicio },
                OR: [
                    { jornada: { division: { ligaId: 'liga-1' } } },
                    { rondaPlayoff: { division: { ligaId: 'liga-1' } } },
                ],
            },
            select: vitest_1.expect.objectContaining({ id: true, fecha: true, fechaFin: true, canchaId: true }),
        }));
        (0, vitest_1.expect)(result.map(({ id, division }) => [id, division.id])).toEqual([['regular', 'd1'], ['playoff', 'd2']]);
    });
});
//# sourceMappingURL=repository.test.js.map