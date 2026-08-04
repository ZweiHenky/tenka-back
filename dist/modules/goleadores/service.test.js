"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ divisionFindFirst: vitest_1.vi.fn(), allocationFindMany: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        division: { findFirst: mocks.divisionFindFirst },
        anotacionPartido: { findMany: mocks.allocationFindMany },
    },
}));
const service_1 = require("./service");
const row = (overrides) => ({
    jugadorId: 'player-1', equipoId: 'team-1', ladoMarcador: 'LOCAL', cantidad: 1,
    jugadorNombre: 'Snapshot', equipoNombre: 'Snapshot Team',
    jugador: { nombre: 'Actual', foto: 'photo.jpg' }, equipo: { nombre: 'Current Team' },
    partido: { tipoPartido: 'REGULAR' }, ...overrides,
});
(0, vitest_1.describe)('goleadoresService', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    });
    (0, vitest_1.it)('applies competition side scope, aggregates teams, and returns deterministic sequential ranks', async () => {
        mocks.allocationFindMany.mockResolvedValue([
            row({ cantidad: 2 }),
            row({ equipoId: 'team-2', equipoNombre: 'Second', equipo: null, cantidad: 1, partido: { tipoPartido: 'ELIMINATORIA' } }),
            row({ jugadorId: 'player-2', jugador: null, jugadorNombre: 'Beto', cantidad: 3 }),
            row({ jugadorId: 'ignored', cantidad: 10, partido: { tipoPartido: 'AMISTOSO' } }),
            row({ jugadorId: 'ignored-away', ladoMarcador: 'VISITANTE', cantidad: 10, partido: { tipoPartido: 'COMPLEMENTO' } }),
            row({ jugadorId: null, jugadorNombre: null, jugador: null, cantidad: 4, partido: { tipoPartido: 'COMPLEMENTO' } }),
        ]);
        await (0, vitest_1.expect)(service_1.goleadoresService.findByDivision('division-1')).resolves.toEqual(vitest_1.expect.objectContaining({
            ranking: 'SEQUENTIAL',
            unattributedGoals: 4,
            rows: [
                vitest_1.expect.objectContaining({ rank: 1, jugadorId: 'player-1', nombre: 'Actual', goles: 3, equipos: vitest_1.expect.any(Array) }),
                vitest_1.expect.objectContaining({ rank: 2, jugadorId: 'player-2', nombre: 'Beto', goles: 3 }),
            ],
        }));
    });
    (0, vitest_1.it)('hides draft divisions from public callers', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.goleadoresService.findByDivision('draft')).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.allocationFindMany).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.test.js.map