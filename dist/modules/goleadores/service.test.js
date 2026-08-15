"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ divisionFindFirst: vitest_1.vi.fn(), queryRaw: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        division: { findFirst: mocks.divisionFindFirst },
        $queryRaw: mocks.queryRaw,
    },
}));
const service_1 = require("./service");
(0, vitest_1.describe)('goleadoresService', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    });
    (0, vitest_1.it)('uses one parameterized aggregate query and preserves deterministic sequential ranking', async () => {
        mocks.queryRaw.mockResolvedValue([
            { jugadorId: 'player-1', playerKey: 'player-1', nombre: 'Actual', foto: 'photo.jpg', equipoId: 'team-1', teamKey: 'team-1', equipoNombre: 'Current Team', golesEquipo: 2n, golesJugador: 3n, unattributedGoals: 4n },
            { jugadorId: 'player-1', playerKey: 'player-1', nombre: 'Actual', foto: 'photo.jpg', equipoId: 'team-2', teamKey: 'team-2', equipoNombre: 'Second', golesEquipo: 1n, golesJugador: 3n, unattributedGoals: 4n },
            { jugadorId: 'player-2', playerKey: 'player-2', nombre: 'Beto', foto: null, equipoId: 'team-1', teamKey: 'team-1', equipoNombre: 'Current Team', golesEquipo: 3n, golesJugador: 3n, unattributedGoals: 4n },
        ]);
        const result = await service_1.goleadoresService.findByDivision('division-1');
        (0, vitest_1.expect)(mocks.queryRaw).toHaveBeenCalledTimes(1);
        const query = mocks.queryRaw.mock.calls[0][0];
        (0, vitest_1.expect)(query.values).toEqual(['division-1', 'division-1']);
        (0, vitest_1.expect)(query.strings.join('')).toContain('SUM(cantidad)');
        (0, vitest_1.expect)(result).toEqual(vitest_1.expect.objectContaining({
            ranking: 'SEQUENTIAL',
            unattributedGoals: 4,
            rows: [
                vitest_1.expect.objectContaining({ rank: 1, jugadorId: 'player-1', nombre: 'Actual', goles: 3, equipos: [
                        vitest_1.expect.objectContaining({ equipoId: 'team-1', goles: 2 }),
                        vitest_1.expect.objectContaining({ equipoId: 'team-2', goles: 1 }),
                    ] }),
                vitest_1.expect.objectContaining({ rank: 2, jugadorId: 'player-2', nombre: 'Beto', goles: 3 }),
            ],
        }));
    });
    (0, vitest_1.it)('returns unattributed goals when no player has attributed goals', async () => {
        mocks.queryRaw.mockResolvedValue([{ jugadorId: null, playerKey: null, nombre: null, foto: null, equipoId: null, teamKey: null, equipoNombre: null, golesEquipo: null, golesJugador: null, unattributedGoals: 5n }]);
        await (0, vitest_1.expect)(service_1.goleadoresService.findByDivision('division-1')).resolves.toEqual({
            divisionId: 'division-1', ranking: 'SEQUENTIAL', rows: [], unattributedGoals: 5,
        });
    });
    (0, vitest_1.it)('hides draft divisions from public callers', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.goleadoresService.findByDivision('draft')).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.queryRaw).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.test.js.map