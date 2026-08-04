"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ recalculate: vitest_1.vi.fn(), sync: vitest_1.vi.fn() }));
vitest_1.vi.mock('../tabla-posicion/service', () => ({ tablaPosicionService: { recalcular: mocks.recalculate } }));
vitest_1.vi.mock('../ronda-playoff/service', () => ({ rondaPlayoffService: { syncAdvancement: mocks.sync } }));
const resultWriter_1 = require("./resultWriter");
const context = {
    id: 'match-1',
    version: 3,
    estado: 'PROGRAMADO',
    golesLocal: 2,
    golesVisitante: 1,
    penalesLocal: null,
    penalesVisitante: null,
    jornadaId: 'week-1',
    rondaPlayoffId: null,
    equipoLocalId: 'team-local',
    equipoVisitanteId: 'team-away',
    fecha: new Date('2026-08-02T18:00:00Z'),
    fechaFin: new Date('2026-08-02T19:00:00Z'),
    canchaId: null,
    jornada: { division: { id: 'division-1', liga: { id: 'league-1', userId: 'owner-1', multiplesCanchas: false } } },
    rondaPlayoff: null,
};
function createTx() {
    return {
        partido: {
            findUnique: vitest_1.vi.fn().mockResolvedValueOnce(context).mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' }),
            updateMany: vitest_1.vi.fn().mockResolvedValue({ count: 1 }),
        },
        divisionJugador: {
            findMany: vitest_1.vi.fn().mockResolvedValue([{
                    jugadorId: 'player-1',
                    equipoId: 'team-local',
                    dorsal: 9,
                    jugador: { nombre: 'Ana' },
                    equipo: { nombre: 'Locales' },
                }]),
        },
        equipo: { findMany: vitest_1.vi.fn().mockResolvedValue([{ id: 'team-local', nombre: 'Locales' }, { id: 'team-away', nombre: 'Visita' }]) },
        anotacionPartido: { findMany: vitest_1.vi.fn().mockResolvedValue([]), deleteMany: vitest_1.vi.fn(), createMany: vitest_1.vi.fn() },
    };
}
(0, vitest_1.describe)('writeResultInTransaction', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('stores named snapshots and exactly one unattributed remainder', async () => {
        const tx = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3,
            estado: 'FINALIZADO',
            golesLocal: 3,
            golesVisitante: 1,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 2 }],
        });
        (0, vitest_1.expect)(tx.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: { id: 'match-1', version: 3 } }));
        (0, vitest_1.expect)(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({ jugadorId: 'player-1', equipoId: 'team-local', jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9, cantidad: 2 }),
                vitest_1.expect.objectContaining({ jugadorId: null, ladoMarcador: 'LOCAL', cantidad: 1 }),
                vitest_1.expect.objectContaining({ jugadorId: null, ladoMarcador: 'VISITANTE', cantidad: 1 }),
            ]) });
        (0, vitest_1.expect)(mocks.recalculate).toHaveBeenCalledWith('division-1', tx);
    });
    (0, vitest_1.it)('rejects over-allocation, duplicate players, invalid membership, and stale versions', async () => {
        const over = createTx();
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(over, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: null, cantidad: 2 }],
        })).rejects.toThrow('superar el marcador');
        const duplicate = createTx();
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(duplicate, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 0,
            allocations: [
                { ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 },
                { ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 },
            ],
        })).rejects.toThrow('repetir un jugador');
        const invalid = createTx();
        invalid.divisionJugador.findMany.mockResolvedValue([]);
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(invalid, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
        })).rejects.toThrow('no pertenece');
        const stale = createTx();
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(stale, 'match-1', {
            expectedVersion: 2, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
        })).rejects.toMatchObject({ statusCode: 409 });
    });
    (0, vitest_1.it)('clears allocations on PROGRAMADO and retains them on SUSPENDIDO', async () => {
        const reopened = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(reopened, 'match-1', {
            expectedVersion: 3, estado: 'PROGRAMADO', golesLocal: 9, golesVisitante: 9, allocations: [],
        });
        (0, vitest_1.expect)(reopened.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ golesLocal: 0, golesVisitante: 0 }) }));
        (0, vitest_1.expect)(reopened.anotacionPartido.deleteMany).toHaveBeenCalledOnce();
        const suspended = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(suspended, 'match-1', {
            expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [],
        });
        (0, vitest_1.expect)(suspended.anotacionPartido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(suspended.anotacionPartido.createMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(suspended.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            data: vitest_1.expect.objectContaining({ golesLocal: 2, golesVisitante: 1 }),
        }));
    });
    (0, vitest_1.it)('keeps a historical scorer after roster removal and distinguishes memberships by team', async () => {
        const historical = createTx();
        historical.divisionJugador.findMany.mockResolvedValue([]);
        historical.anotacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(historical, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
        });
        (0, vitest_1.expect)(historical.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorId: 'player-1', equipoId: 'team-local', jugadorNombre: 'Ana histórica', dorsal: 9,
                })] });
    });
});
//# sourceMappingURL=resultWriter.test.js.map