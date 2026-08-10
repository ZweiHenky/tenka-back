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
    tipoPartido: 'REGULAR',
    jornadaId: 'week-1',
    rondaPlayoffId: null,
    equipoLocalId: 'team-local',
    equipoVisitanteId: 'team-away',
    fecha: new Date('2026-08-02T18:00:00Z'),
    fechaFin: new Date('2026-08-02T19:00:00Z'),
    canchaId: null,
    jornada: { division: { id: 'division-1', registrarParticipaciones: false, usarPenalesEnEmpates: false, liga: { id: 'league-1', userId: 'owner-1', multiplesCanchas: false } } },
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
        participacionPartido: { findMany: vitest_1.vi.fn().mockResolvedValue([]), deleteMany: vitest_1.vi.fn(), createMany: vitest_1.vi.fn() },
    };
}
function withParticipationEnabled(tx) {
    tx.partido.findUnique
        .mockReset()
        .mockResolvedValueOnce({
        ...context,
        jornada: { division: { id: 'division-1', registrarParticipaciones: true, usarPenalesEnEmpates: false, liga: { id: 'league-1', userId: 'owner-1', multiplesCanchas: false } } },
    })
        .mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' });
    return tx;
}
function withPenaltiesEnabled(tx) {
    tx.partido.findUnique
        .mockReset()
        .mockResolvedValueOnce({
        ...context,
        jornada: { division: { ...context.jornada.division, usarPenalesEnEmpates: true } },
    })
        .mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' });
    return tx;
}
(0, vitest_1.describe)('writeResultInTransaction', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('aplica la regla de empates configurada en la división', async () => {
        const withPenalties = withPenaltiesEnabled(createTx());
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(withPenalties, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1, allocations: [],
        })).rejects.toThrow('debe definir un ganador por penales');
        const withoutPenalties = createTx();
        withoutPenalties.partido.findUnique
            .mockReset()
            .mockResolvedValueOnce({
            ...context,
            jornada: { division: { ...context.jornada.division, usarPenalesEnEmpates: false } },
        })
            .mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' });
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(withoutPenalties, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1, allocations: [],
        })).resolves.toBeTruthy();
        const forbiddenPenalties = createTx();
        forbiddenPenalties.partido.findUnique
            .mockReset()
            .mockResolvedValueOnce({
            ...context,
            jornada: { division: { ...context.jornada.division, usarPenalesEnEmpates: false } },
        });
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(forbiddenPenalties, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1,
            penalesLocal: 5, penalesVisitante: 4, allocations: [],
        })).rejects.toThrow('no usa penales');
    });
    (0, vitest_1.it)('rechaza penales parciales, empatados o con un marcador no empatado', async () => {
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(withPenaltiesEnabled(createTx()), 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1,
            penalesLocal: 4, allocations: [],
        })).rejects.toThrow('debe definir un ganador por penales');
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(withPenaltiesEnabled(createTx()), 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1,
            penalesLocal: 4, penalesVisitante: 4, allocations: [],
        })).rejects.toThrow('debe definir un ganador por penales');
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(createTx(), 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 1,
            penalesLocal: 4, penalesVisitante: 3, allocations: [],
        })).rejects.toThrow('marcador está empatado');
    });
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
    (0, vitest_1.it)('clears allocations and participations on PROGRAMADO and retains them on SUSPENDIDO', async () => {
        const reopened = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(reopened, 'match-1', {
            expectedVersion: 3, estado: 'PROGRAMADO', golesLocal: 9, golesVisitante: 9, allocations: [],
        });
        (0, vitest_1.expect)(reopened.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ golesLocal: 0, golesVisitante: 0 }) }));
        (0, vitest_1.expect)(reopened.anotacionPartido.deleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(reopened.participacionPartido.deleteMany).toHaveBeenCalledOnce();
        const suspended = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(suspended, 'match-1', {
            expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [],
        });
        (0, vitest_1.expect)(suspended.anotacionPartido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(suspended.anotacionPartido.createMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(suspended.participacionPartido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(suspended.participacionPartido.createMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(suspended.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            data: vitest_1.expect.objectContaining({ golesLocal: 2, golesVisitante: 1 }),
        }));
    });
    (0, vitest_1.it)('requires participaciones when the division enables them and the result is final', async () => {
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(withParticipationEnabled(createTx()), 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
        })).rejects.toThrow('Debes registrar los jugadores que participaron');
    });
    (0, vitest_1.it)('rejects a final result where a named scorer is not registered as a participant', async () => {
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(withParticipationEnabled(createTx()), 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
            participaciones: [],
        })).rejects.toThrow('Todos los goleadores deben estar registrados como participantes');
    });
    (0, vitest_1.it)('rejects a player participating for both teams of the same match', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([
            { jugadorId: 'player-1', equipoId: 'team-local', dorsal: 9, jugador: { nombre: 'Ana' }, equipo: { nombre: 'Locales' } },
            { jugadorId: 'player-1', equipoId: 'team-away', dorsal: 10, jugador: { nombre: 'Ana' }, equipo: { nombre: 'Visita' } },
        ]);
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
            participaciones: [
                { ladoMarcador: 'LOCAL', jugadorId: 'player-1' },
                { ladoMarcador: 'VISITANTE', jugadorId: 'player-1' },
            ],
        })).rejects.toThrow('Un jugador no puede participar por ambos equipos');
    });
    (0, vitest_1.it)('rejects a participant not in the division roster', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([]);
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
        })).rejects.toThrow('El jugador no pertenece al equipo y división');
    });
    (0, vitest_1.it)('writes participation snapshots with player, team and dorsal when enabled', async () => {
        const tx = withParticipationEnabled(createTx());
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
        });
        (0, vitest_1.expect)(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-local',
                    ladoMarcador: 'LOCAL', jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9,
                })] });
    });
    (0, vitest_1.it)('keeps a historical participant after roster removal', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([]);
        tx.participacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
        });
        (0, vitest_1.expect)(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorId: 'player-1', equipoId: 'team-local', jugadorNombre: 'Ana histórica', dorsal: 9,
                })] });
    });
    (0, vitest_1.it)('seeds a participant from a historical scorer snapshot when the player left the roster', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([]);
        tx.participacionPartido.findMany.mockResolvedValue([]);
        tx.anotacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
        });
        (0, vitest_1.expect)(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-local',
                    ladoMarcador: 'LOCAL', jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
                })] });
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
    (0, vitest_1.it)('preserves historical scorer and participation snapshots when the player is back in the roster', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', dorsal: 18,
                jugador: { nombre: 'Ana actual' }, equipo: { nombre: 'Locales actuales' },
            }]);
        tx.anotacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'snapshot-player', equipoIdSnapshot: 'snapshot-team', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
            }]);
        tx.participacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'snapshot-player', equipoIdSnapshot: 'snapshot-team', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
        });
        const historicalSnapshot = {
            jugadorId: 'player-1', equipoId: 'team-local',
            jugadorIdSnapshot: 'snapshot-player', equipoIdSnapshot: 'snapshot-team',
            jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
        };
        (0, vitest_1.expect)(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining(historicalSnapshot)] });
        (0, vitest_1.expect)(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining(historicalSnapshot)] });
    });
    (0, vitest_1.it)('fills legacy null scorer snapshot ids while preserving historical metadata', async () => {
        const tx = createTx();
        tx.divisionJugador.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', dorsal: 18,
                jugador: { nombre: 'Ana actual' }, equipo: { nombre: 'Locales actuales' },
            }]);
        tx.anotacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: null, equipoIdSnapshot: null, ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
        });
        (0, vitest_1.expect)(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-local',
                    jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
                })] });
    });
    (0, vitest_1.it)('ignores participaciones and keeps history when the division has the feature disabled', async () => {
        const tx = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
            participaciones: [],
        });
        (0, vitest_1.expect)(tx.participacionPartido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(tx.participacionPartido.createMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('ignores a non-empty participation list when the division has the feature disabled', async () => {
        const tx = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-2' }],
        });
        (0, vitest_1.expect)(tx.participacionPartido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(tx.participacionPartido.createMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects participaciones when suspending a match', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([]);
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
        })).rejects.toThrow('Las notas y los participantes solo pueden guardarse al finalizar el partido');
    });
    (0, vitest_1.it)('rejects a scorer outside the saved participation history when the feature is disabled', async () => {
        const tx = createTx();
        tx.participacionPartido.findMany.mockResolvedValue([
            { jugadorId: 'player-1', jugadorIdSnapshot: null, ladoMarcador: 'LOCAL' },
        ]);
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-other', cantidad: 1 }],
        })).rejects.toThrow('Activa el registro de participantes');
    });
    (0, vitest_1.it)('allows a scorer already present in the saved participation history when the feature is disabled', async () => {
        const tx = createTx();
        tx.participacionPartido.findMany.mockResolvedValue([
            { jugadorId: 'player-1', jugadorIdSnapshot: null, ladoMarcador: 'LOCAL' },
        ]);
        tx.divisionJugador.findMany.mockResolvedValue([]);
        tx.anotacionPartido.findMany.mockResolvedValue([{
                jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
        });
        (0, vitest_1.expect)(tx.anotacionPartido.createMany).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('accepts an empty participation list as incomparecencia when enabled', async () => {
        const tx = withParticipationEnabled(createTx());
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
            participaciones: [],
        });
        (0, vitest_1.expect)(tx.participacionPartido.deleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(tx.participacionPartido.createMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('recreates a deleted participant using snapshots and null foreign keys', async () => {
        const tx = withParticipationEnabled(createTx());
        tx.divisionJugador.findMany.mockResolvedValue([]);
        tx.participacionPartido.findMany.mockResolvedValue([{
                jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
            participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-deleted' }],
        });
        (0, vitest_1.expect)(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local',
                    jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
                })] });
    });
    (0, vitest_1.it)('recreates a deleted scorer using snapshots and null foreign keys', async () => {
        const tx = createTx();
        tx.divisionJugador.findMany.mockResolvedValue([]);
        tx.anotacionPartido.findMany.mockResolvedValue([{
                jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local', ladoMarcador: 'LOCAL',
                jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
            }]);
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
            allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-deleted', cantidad: 1 }],
        });
        (0, vitest_1.expect)(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [vitest_1.expect.objectContaining({
                    jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local',
                    jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
                })] });
    });
    (0, vitest_1.it)('writes notas when the result is finalized', async () => {
        const tx = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [], notas: 'Incidencias del partido',
        });
        (0, vitest_1.expect)(tx.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            data: vitest_1.expect.objectContaining({ notas: 'Incidencias del partido' }),
        }));
    });
    (0, vitest_1.it)('clears notas when explicitly set to null', async () => {
        const tx = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [], notas: null,
        });
        (0, vitest_1.expect)(tx.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            data: vitest_1.expect.objectContaining({ notas: null }),
        }));
    });
    (0, vitest_1.it)('preserves notas when the client omits the field', async () => {
        const tx = createTx();
        await (0, resultWriter_1.writeResultInTransaction)(tx, 'match-1', {
            expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
        });
        (0, vitest_1.expect)(tx.partido.updateMany.mock.calls[0][0].data).not.toHaveProperty('notas');
    });
    (0, vitest_1.it)('rejects notas on PROGRAMADO and SUSPENDIDO transitions', async () => {
        const reopened = createTx();
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(reopened, 'match-1', {
            expectedVersion: 3, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, allocations: [], notas: 'Debe conservarse',
        })).rejects.toThrow('Las notas y los participantes solo pueden guardarse al finalizar el partido');
        const suspended = createTx();
        await (0, vitest_1.expect)((0, resultWriter_1.writeResultInTransaction)(suspended, 'match-1', {
            expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [], notas: 'Debe conservarse',
        })).rejects.toThrow('Las notas y los participantes solo pueden guardarse al finalizar el partido');
    });
});
//# sourceMappingURL=resultWriter.test.js.map