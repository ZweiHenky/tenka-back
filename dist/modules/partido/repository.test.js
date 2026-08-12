"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    partidoFindMany: vitest_1.vi.fn(),
    partidoFindUnique: vitest_1.vi.fn(),
    partidoFindFirst: vitest_1.vi.fn(),
    jornadaFindFirst: vitest_1.vi.fn(),
    rondaPlayoffFindFirst: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        partido: { findMany: mocks.partidoFindMany, findUnique: mocks.partidoFindUnique, findFirst: mocks.partidoFindFirst },
        jornada: { findFirst: mocks.jornadaFindFirst },
        rondaPlayoff: { findFirst: mocks.rondaPlayoffFindFirst },
    },
}));
const repository_1 = require("./repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const other = { id: 'other-1', email: 'other@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const published = { estadoLiga: { nombre: { not: 'Borrador' } } };
const partido = {
    id: 'partido-1',
    golesLocal: 2,
    golesVisitante: 1,
    equipoLocal: { id: 'local-1', nombre: 'Local', logo: null },
    equipoVisitante: { id: 'visitante-1', nombre: 'Visitante', logo: 'logo.png' },
    cancha: { id: 'cancha-1', nombre: 'Central' },
    arbitros: [{ arbitro: { id: 'arbitro-1', nombre: 'Alex' } }],
};
(0, vitest_1.describe)('partidoRepository public reads', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.partidoFindMany.mockResolvedValue([partido]);
        mocks.partidoFindUnique.mockResolvedValue(partido);
        mocks.partidoFindFirst.mockResolvedValue(partido);
        mocks.jornadaFindFirst.mockResolvedValue({ partidos: [partido] });
        mocks.rondaPlayoffFindFirst.mockResolvedValue({ partidos: [partido] });
    });
    vitest_1.it.each([
        ['anonymous', undefined, published],
        ['owner', owner, { OR: [published, { liga: { userId: owner.id } }] }],
        ['admin', admin, {}],
    ])('lists visible partidos for %s in one domain query', async (_label, actor, visibility) => {
        const result = await repository_1.partidoRepository.findAllVisible(actor);
        (0, vitest_1.expect)(mocks.partidoFindMany).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoFindMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { OR: [
                    { jornada: { division: visibility } },
                    { rondaPlayoff: { division: visibility } },
                ] },
        }));
        (0, vitest_1.expect)(result[0]).toMatchObject({ ...partido, arbitros: [{ id: 'arbitro-1', nombre: 'Alex' }] });
    });
    vitest_1.it.each([
        ['jornada', repository_1.partidoRepository.findVisibleByJornada, mocks.jornadaFindFirst],
        ['ronda playoff', repository_1.partidoRepository.findVisibleByRondaPlayoff, mocks.rondaPlayoffFindFirst],
    ])('loads a visible %s and its partidos in one parent query', async (_label, method, findFirst) => {
        const result = await method('parent-1', owner);
        (0, vitest_1.expect)(findFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(findFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: {
                id: 'parent-1',
                division: { OR: [published, { liga: { userId: owner.id } }] },
            },
            select: { partidos: { include: vitest_1.expect.any(Object) } },
        }));
        (0, vitest_1.expect)(result?.[0]).toMatchObject({ ...partido, arbitros: [{ id: 'arbitro-1', nombre: 'Alex' }] });
    });
    vitest_1.it.each([
        ['anonymous', undefined, published],
        ['admin', admin, {}],
    ])('applies %s visibility to both parent query shapes', async (_label, actor, visibility) => {
        await repository_1.partidoRepository.findVisibleByJornada('jornada-1', actor);
        await repository_1.partidoRepository.findVisibleByRondaPlayoff('ronda-1', actor);
        (0, vitest_1.expect)(mocks.jornadaFindFirst.mock.calls[0][0].where.division).toEqual(visibility);
        (0, vitest_1.expect)(mocks.rondaPlayoffFindFirst.mock.calls[0][0].where.division).toEqual(visibility);
    });
    vitest_1.it.each([
        ['jornada', repository_1.partidoRepository.findVisibleByJornada, mocks.jornadaFindFirst],
        ['ronda playoff', repository_1.partidoRepository.findVisibleByRondaPlayoff, mocks.rondaPlayoffFindFirst],
    ])('distinguishes a visible empty %s from a hidden or missing parent', async (_label, method, findFirst) => {
        findFirst.mockResolvedValueOnce({ partidos: [] }).mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(method('visible')).resolves.toEqual([]);
        await (0, vitest_1.expect)(method('hidden-or-missing')).resolves.toBeNull();
    });
    (0, vitest_1.it)('exposes participaciones with snapshot id fallback in detail reads', async () => {
        mocks.partidoFindUnique.mockResolvedValue({
            ...partido,
            participaciones: [{
                    id: 'part-1',
                    jugadorId: null,
                    equipoId: null,
                    jugadorIdSnapshot: 'player-1',
                    equipoIdSnapshot: 'team-1',
                    ladoMarcador: 'LOCAL',
                    jugadorNombre: 'Ana',
                    equipoNombre: 'Locales',
                    dorsal: 9,
                }],
        });
        const result = await repository_1.partidoRepository.findById('partido-1');
        (0, vitest_1.expect)(mocks.partidoFindUnique).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            include: vitest_1.expect.objectContaining({ participaciones: vitest_1.expect.any(Object) }),
        }));
        (0, vitest_1.expect)(result?.participaciones).toEqual([vitest_1.expect.objectContaining({ jugadorId: 'player-1', equipoId: 'team-1' })]);
        (0, vitest_1.expect)(result?.participaciones?.[0]).not.toHaveProperty('jugadorIdSnapshot');
        (0, vitest_1.expect)(result?.participaciones?.[0]).not.toHaveProperty('equipoIdSnapshot');
    });
    (0, vitest_1.it)('exposes scorer snapshots through public fields without internal snapshot ids', async () => {
        mocks.partidoFindFirst.mockResolvedValue({
            ...partido,
            anotaciones: [{
                    id: 'goal-1', jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-1',
                    ladoMarcador: 'LOCAL', cantidad: 2, jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9,
                }],
        });
        const result = await repository_1.partidoRepository.findVisibleById('partido-1');
        (0, vitest_1.expect)(result?.anotaciones?.[0]).toEqual({
            id: 'goal-1', jugadorId: 'player-1', equipoId: 'team-1', ladoMarcador: 'LOCAL', cantidad: 2,
            jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9,
        });
        (0, vitest_1.expect)(result?.anotaciones?.[0]).not.toHaveProperty('jugadorIdSnapshot');
    });
    (0, vitest_1.it)('exposes private notas only to the league owner and strips them from other reads', async () => {
        const withNotas = {
            ...partido,
            notas: 'Solo dueño y árbitro',
            jornada: { division: { liga: { userId: 'owner-1' } } },
        };
        mocks.partidoFindFirst.mockResolvedValue(withNotas);
        const ownerResult = await repository_1.partidoRepository.findVisibleById('partido-1', owner);
        (0, vitest_1.expect)(ownerResult?.notas).toBe('Solo dueño y árbitro');
        mocks.partidoFindFirst.mockResolvedValue({ ...withNotas, jornada: { division: { liga: { userId: 'someone-else' } } } });
        const stranger = await repository_1.partidoRepository.findVisibleById('partido-1', other);
        (0, vitest_1.expect)(stranger?.notas).toBeUndefined();
        mocks.partidoFindFirst.mockResolvedValue(withNotas);
        const anonymous = await repository_1.partidoRepository.findVisibleById('partido-1', undefined);
        (0, vitest_1.expect)(anonymous?.notas).toBeUndefined();
    });
    (0, vitest_1.it)('strips notas in the generic detail read', async () => {
        mocks.partidoFindUnique.mockResolvedValue({ ...partido, notas: 'privada' });
        const result = await repository_1.partidoRepository.findById('partido-1');
        (0, vitest_1.expect)(result?.notas).toBeUndefined();
    });
});
//# sourceMappingURL=repository.test.js.map