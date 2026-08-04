"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findVisibleById: vitest_1.vi.fn(),
    findVisibleByDivision: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
    divisionFindUnique: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
    roundCreateManyAndReturn: vitest_1.vi.fn(),
    roundFindUnique: vitest_1.vi.fn(),
    roundDelete: vitest_1.vi.fn(),
    roundDeleteMany: vitest_1.vi.fn(),
    partidoCreateMany: vitest_1.vi.fn(),
    partidoFindMany: vitest_1.vi.fn(),
    partidoCreate: vitest_1.vi.fn(),
    partidoDelete: vitest_1.vi.fn(),
    partidoUpdate: vitest_1.vi.fn(),
    anotacionDeleteMany: vitest_1.vi.fn(),
    executeRaw: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./repository', () => ({ rondaPlayoffRepository: mocks }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        division: { findFirst: mocks.divisionFindFirst, findUnique: mocks.divisionFindUnique },
        $transaction: mocks.transaction,
    },
}));
const service_1 = require("./service");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
(0, vitest_1.describe)('rondaPlayoffService public reads', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('gets visible detail in one repository operation and preserves its shape', async () => {
        const ronda = { id: 'ronda-1', orden: 1, divisionId: 'division-1' };
        mocks.findVisibleById.mockResolvedValue(ronda);
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.getById('ronda-1', owner)).resolves.toBe(ronda);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledWith('ronda-1', owner);
    });
    (0, vitest_1.it)('returns 404 for a hidden or missing round', async () => {
        mocks.findVisibleById.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.getById('ronda-1')).rejects.toMatchObject({
            statusCode: 404,
            message: 'Ronda de playoff no encontrado',
        });
    });
    (0, vitest_1.it)('returns an empty list for a visible division in one repository operation', async () => {
        mocks.findVisibleByDivision.mockResolvedValue([]);
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.findByDivision('division-1', owner)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.findVisibleByDivision).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findVisibleByDivision).toHaveBeenCalledWith('division-1', owner);
    });
    (0, vitest_1.it)('returns 404 for a hidden or missing division', async () => {
        mocks.findVisibleByDivision.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.findByDivision('division-1')).rejects.toMatchObject({
            statusCode: 404,
            message: 'División no encontrado',
        });
    });
});
(0, vitest_1.describe)('rondaPlayoffService batch writes', () => {
    const tx = {
        $executeRawUnsafe: mocks.executeRaw,
        division: {
            findUnique: mocks.divisionFindUnique,
            findFirst: async (...args) => {
                const division = await mocks.divisionFindFirst(...args);
                return division ? { ligaId: 'league-1', ...division } : division;
            },
        },
        rondaPlayoff: {
            createManyAndReturn: mocks.roundCreateManyAndReturn,
            findUnique: mocks.roundFindUnique,
            delete: mocks.roundDelete,
            deleteMany: mocks.roundDeleteMany,
        },
        partido: {
            createMany: mocks.partidoCreateMany,
            create: mocks.partidoCreate,
            delete: mocks.partidoDelete,
            findMany: mocks.partidoFindMany,
            update: mocks.partidoUpdate,
        },
        anotacionPartido: { deleteMany: mocks.anotacionDeleteMany },
    };
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.divisionFindUnique.mockResolvedValue({ ligaId: 'league-1', liga: { userId: owner.id } });
        mocks.divisionFindFirst.mockResolvedValue({
            rondasPlayoff: [],
            equipos: Array.from({ length: 8 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
        });
        mocks.transaction.mockImplementation((callback) => callback(tx));
        mocks.partidoCreateMany.mockResolvedValue({ count: 0 });
        mocks.partidoCreate.mockResolvedValue({});
        mocks.partidoDelete.mockResolvedValue({});
        mocks.partidoUpdate.mockResolvedValue({});
        mocks.roundDelete.mockResolvedValue({});
        mocks.roundDeleteMany.mockResolvedValue({ count: 0 });
        mocks.executeRaw.mockResolvedValue(0);
    });
    (0, vitest_1.it)('generates all rounds and first-round matches atomically within a four-query budget', async () => {
        mocks.roundCreateManyAndReturn.mockResolvedValue([
            { id: 'final', nombre: 'Final', orden: 3, divisionId: 'division-1' },
            { id: 'quarters', nombre: 'Cuartos', orden: 1, divisionId: 'division-1' },
            { id: 'semis', nombre: 'Semifinal', orden: 2, divisionId: 'division-1' },
        ]);
        const result = await service_1.rondaPlayoffService.generate('division-1', 8, owner);
        (0, vitest_1.expect)(result.map((round) => round.id)).toEqual(['quarters', 'semis', 'final']);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindUnique).toHaveBeenCalledWith({ where: { id: 'division-1' }, select: { ligaId: true } });
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', liga: { userId: owner.id } },
            select: {
                ligaId: true,
                rondasPlayoff: { take: 1, select: { id: true } },
                equipos: {
                    select: {
                        equipoId: true,
                        equipo: {
                            select: {
                                nombre: true,
                                tablaPosiciones: {
                                    where: { divisionId: 'division-1' },
                                    select: { puntos: true, diferenciaGoles: true, ganados: true, golesFavor: true },
                                },
                            },
                        },
                    },
                },
            },
        });
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.roundCreateManyAndReturn).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoCreateMany).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoCreateMany).toHaveBeenCalledWith({
            data: [
                vitest_1.expect.objectContaining({ llave: 1, equipoLocalId: 'team-1', equipoVisitanteId: 'team-8', rondaPlayoffId: 'quarters' }),
                vitest_1.expect.objectContaining({ llave: 2, equipoLocalId: 'team-2', equipoVisitanteId: 'team-7', rondaPlayoffId: 'quarters' }),
                vitest_1.expect.objectContaining({ llave: 3, equipoLocalId: 'team-3', equipoVisitanteId: 'team-6', rondaPlayoffId: 'quarters' }),
                vitest_1.expect.objectContaining({ llave: 4, equipoLocalId: 'team-4', equipoVisitanteId: 'team-5', rondaPlayoffId: 'quarters' }),
            ],
        });
    });
    (0, vitest_1.it)('generates a two-team final', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            rondasPlayoff: [], equipos: [assignedTeam('team-2', 'Segundo'), assignedTeam('team-1', 'Primero')],
        });
        mocks.roundCreateManyAndReturn.mockResolvedValue([
            { id: 'final', nombre: 'Final', orden: 1, divisionId: 'division-1' },
        ]);
        await service_1.rondaPlayoffService.generate('division-1', 2, owner);
        (0, vitest_1.expect)(mocks.roundCreateManyAndReturn).toHaveBeenCalledWith({
            data: [{ nombre: 'Final', orden: 1, divisionId: 'division-1' }],
        });
        (0, vitest_1.expect)(mocks.partidoCreateMany).toHaveBeenCalledWith({
            data: [vitest_1.expect.objectContaining({ equipoLocalId: 'team-1', equipoVisitanteId: 'team-2', llave: 1, rondaPlayoffId: 'final' })],
        });
    });
    (0, vitest_1.it)('generates all five rounds and 16 initial matches for 32 teams', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            rondasPlayoff: [], equipos: Array.from({ length: 32 }, (_, index) => assignedTeam(`team-${String(index + 1).padStart(2, '0')}`, `Team ${String(index + 1).padStart(2, '0')}`, { puntos: 32 - index })),
        });
        mocks.roundCreateManyAndReturn.mockResolvedValue(['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'].map((nombre, index) => ({
            id: `round-${index + 1}`, nombre, orden: index + 1, divisionId: 'division-1',
        })));
        await service_1.rondaPlayoffService.generate('division-1', 32, owner);
        (0, vitest_1.expect)(mocks.roundCreateManyAndReturn).toHaveBeenCalledWith({
            data: ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'].map((nombre, index) => ({
                nombre, orden: index + 1, divisionId: 'division-1',
            })),
        });
        const matches = mocks.partidoCreateMany.mock.calls[0][0].data;
        (0, vitest_1.expect)(matches).toHaveLength(16);
        (0, vitest_1.expect)(matches[0]).toMatchObject({ equipoLocalId: 'team-01', equipoVisitanteId: 'team-32', llave: 1, rondaPlayoffId: 'round-1' });
        (0, vitest_1.expect)(matches[15]).toMatchObject({ equipoLocalId: 'team-16', equipoVisitanteId: 'team-17', llave: 16 });
    });
    (0, vitest_1.it)('uses zero defaults for assigned teams without standings', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            rondasPlayoff: [], equipos: [assignedTeam('team-b', 'Beta', { puntos: 0 }), assignedTeam('team-a', 'Alfa')],
        });
        mocks.roundCreateManyAndReturn.mockResolvedValue([
            { id: 'final', nombre: 'Final', orden: 1, divisionId: 'division-1' },
        ]);
        await service_1.rondaPlayoffService.generate('division-1', 2, owner);
        (0, vitest_1.expect)(mocks.partidoCreateMany).toHaveBeenCalledWith({
            data: [vitest_1.expect.objectContaining({ equipoLocalId: 'team-a', equipoVisitanteId: 'team-b' })],
        });
    });
    (0, vitest_1.it)('ranks mixed standings by every statistic before pairing first versus last', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [], equipos: [
                assignedTeam('team-1', 'Zulu', { puntos: 10, diferenciaGoles: 5, ganados: 3, golesFavor: 10 }),
                assignedTeam('team-2', 'Alfa', { puntos: 10, diferenciaGoles: 5, ganados: 3, golesFavor: 11 }),
                assignedTeam('team-3', 'Beta', { puntos: 10, diferenciaGoles: 6, ganados: 1, golesFavor: 2 }),
                assignedTeam('team-4', 'Celta', { puntos: 11, diferenciaGoles: 0, ganados: 0, golesFavor: 0 }),
            ] });
        mocks.roundCreateManyAndReturn.mockResolvedValue([
            { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
            { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
        ]);
        await service_1.rondaPlayoffService.generate('division-1', 4, owner);
        (0, vitest_1.expect)(mocks.partidoCreateMany.mock.calls[0][0].data).toEqual([
            vitest_1.expect.objectContaining({ equipoLocalId: 'team-4', equipoVisitanteId: 'team-1' }),
            vitest_1.expect.objectContaining({ equipoLocalId: 'team-3', equipoVisitanteId: 'team-2' }),
        ]);
    });
    (0, vitest_1.it)('breaks full statistical ties by Spanish base name and then team id', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [], equipos: [
                assignedTeam('team-z', 'Zeta'),
                assignedTeam('team-b', 'Águila'),
                assignedTeam('team-a', 'aguila'),
                assignedTeam('team-c', 'Beta'),
            ] });
        mocks.roundCreateManyAndReturn.mockResolvedValue([
            { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
            { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
        ]);
        await service_1.rondaPlayoffService.generate('division-1', 4, owner);
        (0, vitest_1.expect)(mocks.partidoCreateMany.mock.calls[0][0].data).toEqual([
            vitest_1.expect.objectContaining({ equipoLocalId: 'team-a', equipoVisitanteId: 'team-z' }),
            vitest_1.expect.objectContaining({ equipoLocalId: 'team-b', equipoVisitanteId: 'team-c' }),
        ]);
    });
    vitest_1.it.each([1, 3, 6, 64])('rejects unsupported team count %i', async (cantidadEquipos) => {
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.generate('division-1', cantidadEquipos, owner)).rejects.toMatchObject({
            statusCode: 422,
            message: 'La cantidad debe ser 2, 4, 8, 16 o 32',
        });
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects a bracket larger than the assigned team set', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [], equipos: [assignedTeam('team-1', 'Alfa')] });
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
            statusCode: 422,
            message: 'Se necesitan al menos 2 equipos asignados a la división',
        });
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
    });
    (0, vitest_1.it)('uses the same not-found response for missing and unauthorized divisions', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
            statusCode: 404,
            message: 'División no encontrado',
        });
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { id: 'division-1', liga: { userId: owner.id } },
        }));
    });
    (0, vitest_1.it)('propagates a first-round insert failure so the transaction rolls back its round insert', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            rondasPlayoff: [], equipos: Array.from({ length: 4 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
        });
        mocks.roundCreateManyAndReturn.mockResolvedValue([
            { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
            { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
        ]);
        mocks.partidoCreateMany.mockRejectedValue(new Error('match insert failed'));
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.generate('division-1', 4, owner)).rejects.toThrow('match insert failed');
        (0, vitest_1.expect)(mocks.roundCreateManyAndReturn).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoCreateMany).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('rejects duplicate bracket generation after rereading rounds under the league lock', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [{ id: 'existing' }], equipos: [] });
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
            statusCode: 409,
            message: 'La división ya tiene rondas de playoff',
        });
        (0, vitest_1.expect)(mocks.executeRaw).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'league-1');
        (0, vitest_1.expect)(mocks.roundCreateManyAndReturn).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('maps a concurrent unique collision during generation to conflict', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            rondasPlayoff: [],
            equipos: [assignedTeam('team-1', 'Uno'), assignedTeam('team-2', 'Dos')],
        });
        mocks.roundCreateManyAndReturn.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({ statusCode: 409 });
    });
    (0, vitest_1.it)('deletes an individual round only when it is the latest round', async () => {
        mocks.roundFindUnique
            .mockResolvedValueOnce({ divisionId: 'division-1', division: { ligaId: 'league-1' } })
            .mockResolvedValueOnce({ orden: 2, division: { ligaId: 'league-1', liga: { userId: owner.id }, rondasPlayoff: [{ id: 'latest' }] } });
        await service_1.rondaPlayoffService.delete('latest', owner);
        (0, vitest_1.expect)(mocks.roundDelete).toHaveBeenCalledWith({ where: { id: 'latest' } });
        (0, vitest_1.expect)(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.roundDelete.mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('rejects deletion of a non-latest round without deleting it', async () => {
        mocks.roundFindUnique
            .mockResolvedValueOnce({ divisionId: 'division-1', division: { ligaId: 'league-1' } })
            .mockResolvedValueOnce({ orden: 1, division: { ligaId: 'league-1', liga: { userId: owner.id }, rondasPlayoff: [{ id: 'latest' }] } });
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.delete('earlier', owner)).rejects.toMatchObject({ statusCode: 409 });
        (0, vitest_1.expect)(mocks.roundDelete).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('advances winners with two reads, one batched insert, and concurrent existing-match updates', async () => {
        mocks.roundFindUnique.mockResolvedValue({
            orden: 1,
            division: { ligaId: 'league-1', rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
        });
        mocks.partidoFindMany.mockResolvedValue([
            finishedMatch('a', 'current', 1, 'team-1', 'team-8', 2, 0),
            finishedMatch('b', 'current', 2, 'team-2', 'team-7', 0, 1),
            finishedMatch('c', 'current', 3, 'team-3', 'team-6', 1, 0),
            finishedMatch('d', 'current', 4, 'team-4', 'team-5', 0, 2),
            { id: 'existing', rondaPlayoffId: 'next', llave: 1 },
        ]);
        await service_1.rondaPlayoffService.advanceWinners('current');
        (0, vitest_1.expect)(mocks.roundFindUnique).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mocks.partidoFindMany).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoCreate).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoCreate).toHaveBeenCalledWith({
            data: vitest_1.expect.objectContaining({ llave: 2, equipoLocalId: 'team-3', equipoVisitanteId: 'team-5' }),
        });
        (0, vitest_1.expect)(mocks.partidoUpdate).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoUpdate).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { id: 'existing' },
            data: vitest_1.expect.objectContaining({ equipoLocalId: 'team-1', equipoVisitanteId: 'team-7', estado: 'PROGRAMADO' }),
        }));
    });
    (0, vitest_1.it)('propagates an advancement update failure from the transaction for atomic rollback', async () => {
        mocks.roundFindUnique.mockResolvedValue({
            orden: 1,
            division: { ligaId: 'league-1', rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
        });
        mocks.partidoFindMany.mockResolvedValue([
            finishedMatch('a', 'current', 1, 'team-1', 'team-4', 2, 0),
            finishedMatch('b', 'current', 2, 'team-2', 'team-3', 0, 1),
            { id: 'existing', rondaPlayoffId: 'next', llave: 1 },
        ]);
        mocks.partidoUpdate.mockRejectedValue(new Error('advance update failed'));
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.advanceWinners('current')).rejects.toThrow('advance update failed');
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.partidoUpdate).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('removes an unattached derived match when its source pair is no longer finalized', async () => {
        mocks.roundFindUnique.mockResolvedValue({
            orden: 1,
            division: { rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
        });
        mocks.partidoFindMany.mockResolvedValue([
            finishedMatch('a', 'current', 1, 'team-1', 'team-4', 2, 0),
            { ...finishedMatch('b', 'current', 2, 'team-2', 'team-3', 0, 1), estado: 'SUSPENDIDO' },
            { id: 'derived', rondaPlayoffId: 'next', llave: 1, estado: 'PROGRAMADO', jornadaId: null },
        ]);
        await service_1.rondaPlayoffService.syncAdvancement(tx, 'current');
        (0, vitest_1.expect)(mocks.partidoDelete).toHaveBeenCalledWith({ where: { id: 'derived' } });
    });
    vitest_1.it.each([
        { estado: 'FINALIZADO', jornadaId: null },
        { estado: 'PROGRAMADO', jornadaId: 'jornada-1' },
    ])('rejects advancement reversal for protected derived match %#', async (protection) => {
        mocks.roundFindUnique.mockResolvedValue({
            orden: 1,
            division: { rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
        });
        mocks.partidoFindMany.mockResolvedValue([
            finishedMatch('a', 'current', 1, 'team-1', 'team-4', 2, 0),
            { ...finishedMatch('b', 'current', 2, 'team-2', 'team-3', 0, 1), estado: 'SUSPENDIDO' },
            { id: 'derived', rondaPlayoffId: 'next', llave: 1, ...protection },
        ]);
        await (0, vitest_1.expect)(service_1.rondaPlayoffService.syncAdvancement(tx, 'current')).rejects.toMatchObject({ statusCode: 409 });
        (0, vitest_1.expect)(mocks.partidoDelete).not.toHaveBeenCalled();
    });
});
function assignedTeam(equipoId, nombre, stats) {
    return {
        equipoId,
        equipo: {
            nombre,
            tablaPosiciones: stats ? [{ puntos: 0, diferenciaGoles: 0, ganados: 0, golesFavor: 0, ...stats }] : [],
        },
    };
}
function finishedMatch(id, rondaPlayoffId, llave, equipoLocalId, equipoVisitanteId, golesLocal, golesVisitante) {
    return {
        id,
        rondaPlayoffId,
        llave,
        equipoLocalId,
        equipoVisitanteId,
        estado: 'FINALIZADO',
        golesLocal,
        golesVisitante,
        penalesLocal: null,
        penalesVisitante: null,
    };
}
//# sourceMappingURL=service.test.js.map