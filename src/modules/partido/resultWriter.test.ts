import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ recalculate: vi.fn(), sync: vi.fn() }))
vi.mock('../tabla-posicion/service', () => ({ tablaPosicionService: { recalcular: mocks.recalculate } }))
vi.mock('../ronda-playoff/service', () => ({ rondaPlayoffService: { syncAdvancement: mocks.sync } }))

import { writeResultInTransaction } from './resultWriter'

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
}

function createTx() {
  return {
    partido: {
      findUnique: vi.fn().mockResolvedValueOnce(context).mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    divisionJugador: {
      findMany: vi.fn().mockResolvedValue([{
        jugadorId: 'player-1',
        equipoId: 'team-local',
        dorsal: 9,
        jugador: { nombre: 'Ana' },
        equipo: { nombre: 'Locales' },
      }]),
    },
    equipo: { findMany: vi.fn().mockResolvedValue([{ id: 'team-local', nombre: 'Locales' }, { id: 'team-away', nombre: 'Visita' }]) },
    anotacionPartido: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
    participacionPartido: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
  }
}

function withParticipationEnabled(tx: any) {
  tx.partido.findUnique
    .mockReset()
    .mockResolvedValueOnce({
      ...context,
      jornada: { division: { id: 'division-1', registrarParticipaciones: true, usarPenalesEnEmpates: false, liga: { id: 'league-1', userId: 'owner-1', multiplesCanchas: false } } },
    })
    .mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' })
  return tx
}

function withPenaltiesEnabled(tx: any) {
  tx.partido.findUnique
    .mockReset()
    .mockResolvedValueOnce({
      ...context,
      jornada: { division: { ...context.jornada.division, usarPenalesEnEmpates: true } },
    })
    .mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' })
  return tx
}

describe('writeResultInTransaction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('aplica la regla de empates configurada en la división', async () => {
    const withPenalties = withPenaltiesEnabled(createTx())
    await expect(writeResultInTransaction(withPenalties as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1, allocations: [],
    })).rejects.toThrow('debe definir un ganador por penales')

    const withoutPenalties = createTx()
    withoutPenalties.partido.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        ...context,
        jornada: { division: { ...context.jornada.division, usarPenalesEnEmpates: false } },
      })
      .mockResolvedValue({ ...context, version: 4, estado: 'FINALIZADO' })
    await expect(writeResultInTransaction(withoutPenalties as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1, allocations: [],
    })).resolves.toBeTruthy()

    const forbiddenPenalties = createTx()
    forbiddenPenalties.partido.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        ...context,
        jornada: { division: { ...context.jornada.division, usarPenalesEnEmpates: false } },
      })
    await expect(writeResultInTransaction(forbiddenPenalties as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1,
      penalesLocal: 5, penalesVisitante: 4, allocations: [],
    })).rejects.toThrow('no usa penales')
  })

  it('rechaza penales parciales, empatados o con un marcador no empatado', async () => {
    await expect(writeResultInTransaction(withPenaltiesEnabled(createTx()) as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1,
      penalesLocal: 4, allocations: [],
    })).rejects.toThrow('debe definir un ganador por penales')

    await expect(writeResultInTransaction(withPenaltiesEnabled(createTx()) as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 1,
      penalesLocal: 4, penalesVisitante: 4, allocations: [],
    })).rejects.toThrow('debe definir un ganador por penales')

    await expect(writeResultInTransaction(createTx() as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 1,
      penalesLocal: 4, penalesVisitante: 3, allocations: [],
    })).rejects.toThrow('marcador está empatado')
  })

  it('stores named snapshots and exactly one unattributed remainder', async () => {
    const tx = createTx()
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3,
      estado: 'FINALIZADO',
      golesLocal: 3,
      golesVisitante: 1,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 2 }],
    })

    expect(tx.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'match-1', version: 3 } }))
    expect(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ jugadorId: 'player-1', equipoId: 'team-local', jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9, cantidad: 2 }),
      expect.objectContaining({ jugadorId: null, ladoMarcador: 'LOCAL', cantidad: 1 }),
      expect.objectContaining({ jugadorId: null, ladoMarcador: 'VISITANTE', cantidad: 1 }),
    ]) })
    expect(mocks.recalculate).toHaveBeenCalledWith('division-1', tx)
  })

  it('rejects over-allocation, duplicate players, invalid membership, and stale versions', async () => {
    const over = createTx()
    await expect(writeResultInTransaction(over as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: null, cantidad: 2 }],
    })).rejects.toThrow('superar el marcador')

    const duplicate = createTx()
    await expect(writeResultInTransaction(duplicate as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 2, golesVisitante: 0,
      allocations: [
        { ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 },
        { ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 },
      ],
    })).rejects.toThrow('repetir un jugador')

    const invalid = createTx()
    invalid.divisionJugador.findMany.mockResolvedValue([])
    await expect(writeResultInTransaction(invalid as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
    })).rejects.toThrow('no pertenece')

    const stale = createTx()
    await expect(writeResultInTransaction(stale as any, 'match-1', {
      expectedVersion: 2, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('clears allocations and participations on PROGRAMADO and retains them on SUSPENDIDO', async () => {
    const reopened = createTx()
    await writeResultInTransaction(reopened as any, 'match-1', {
      expectedVersion: 3, estado: 'PROGRAMADO', golesLocal: 9, golesVisitante: 9, allocations: [],
    })
    expect(reopened.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ golesLocal: 0, golesVisitante: 0 }) }))
    expect(reopened.anotacionPartido.deleteMany).toHaveBeenCalledOnce()
    expect(reopened.participacionPartido.deleteMany).toHaveBeenCalledOnce()

    const suspended = createTx()
    await writeResultInTransaction(suspended as any, 'match-1', {
      expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [],
    })
    expect(suspended.anotacionPartido.deleteMany).not.toHaveBeenCalled()
    expect(suspended.anotacionPartido.createMany).not.toHaveBeenCalled()
    expect(suspended.participacionPartido.deleteMany).not.toHaveBeenCalled()
    expect(suspended.participacionPartido.createMany).not.toHaveBeenCalled()
    expect(suspended.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ golesLocal: 2, golesVisitante: 1 }),
    }))
  })

  it('requires participaciones when the division enables them and the result is final', async () => {
    await expect(writeResultInTransaction(withParticipationEnabled(createTx()) as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
    })).rejects.toThrow('Debes registrar los jugadores que participaron')
  })

  it('rejects a final result where a named scorer is not registered as a participant', async () => {
    await expect(writeResultInTransaction(withParticipationEnabled(createTx()) as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
      participaciones: [],
    })).rejects.toThrow('Todos los goleadores deben estar registrados como participantes')
  })

  it('rejects a player participating for both teams of the same match', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([
      { jugadorId: 'player-1', equipoId: 'team-local', dorsal: 9, jugador: { nombre: 'Ana' }, equipo: { nombre: 'Locales' } },
      { jugadorId: 'player-1', equipoId: 'team-away', dorsal: 10, jugador: { nombre: 'Ana' }, equipo: { nombre: 'Visita' } },
    ])
    await expect(writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      participaciones: [
        { ladoMarcador: 'LOCAL', jugadorId: 'player-1' },
        { ladoMarcador: 'VISITANTE', jugadorId: 'player-1' },
      ],
    })).rejects.toThrow('Un jugador no puede participar por ambos equipos')
  })

  it('rejects a participant not in the division roster', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([])
    await expect(writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
    })).rejects.toThrow('El jugador no pertenece al equipo y división')
  })

  it('writes participation snapshots with player, team and dorsal when enabled', async () => {
    const tx = withParticipationEnabled(createTx())
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
    })

    expect(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-local',
      ladoMarcador: 'LOCAL', jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9,
    })] })
  })

  it('keeps a historical participant after roster removal', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([])
    tx.participacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
    })

    expect(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorId: 'player-1', equipoId: 'team-local', jugadorNombre: 'Ana histórica', dorsal: 9,
    })] })
  })

  it('seeds a participant from a historical scorer snapshot when the player left the roster', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([])
    tx.participacionPartido.findMany.mockResolvedValue([])
    tx.anotacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
    })

    expect(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-local',
      ladoMarcador: 'LOCAL', jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    })] })
  })

  it('keeps a historical scorer after roster removal and distinguishes memberships by team', async () => {
    const historical = createTx()
    historical.divisionJugador.findMany.mockResolvedValue([])
    historical.anotacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    }])

    await writeResultInTransaction(historical as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
    })

    expect(historical.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorId: 'player-1', equipoId: 'team-local', jugadorNombre: 'Ana histórica', dorsal: 9,
    })] })
  })

  it('preserves historical scorer and participation snapshots when the player is back in the roster', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', dorsal: 18,
      jugador: { nombre: 'Ana actual' }, equipo: { nombre: 'Locales actuales' },
    }])
    tx.anotacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'snapshot-player', equipoIdSnapshot: 'snapshot-team', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
    }])
    tx.participacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: 'snapshot-player', equipoIdSnapshot: 'snapshot-team', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
    })

    const historicalSnapshot = {
      jugadorId: 'player-1', equipoId: 'team-local',
      jugadorIdSnapshot: 'snapshot-player', equipoIdSnapshot: 'snapshot-team',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
    }
    expect(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining(historicalSnapshot)] })
    expect(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining(historicalSnapshot)] })
  })

  it('fills legacy null scorer snapshot ids while preserving historical metadata', async () => {
    const tx = createTx()
    tx.divisionJugador.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', dorsal: 18,
      jugador: { nombre: 'Ana actual' }, equipo: { nombre: 'Locales actuales' },
    }])
    tx.anotacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', jugadorIdSnapshot: null, equipoIdSnapshot: null, ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
    })

    expect(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-local',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales históricos', dorsal: 9,
    })] })
  })

  it('ignores participaciones and keeps history when the division has the feature disabled', async () => {
    const tx = createTx()
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
      participaciones: [],
    })

    expect(tx.participacionPartido.deleteMany).not.toHaveBeenCalled()
    expect(tx.participacionPartido.createMany).not.toHaveBeenCalled()
  })

  it('ignores a non-empty participation list when the division has the feature disabled', async () => {
    const tx = createTx()
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-2' }],
    })

    expect(tx.participacionPartido.deleteMany).not.toHaveBeenCalled()
    expect(tx.participacionPartido.createMany).not.toHaveBeenCalled()
  })

  it('rejects participaciones when suspending a match', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([])
    await expect(writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1' }],
    })).rejects.toThrow('Las notas y los participantes solo pueden guardarse al finalizar el partido')
  })

  it('rejects a scorer outside the saved participation history when the feature is disabled', async () => {
    const tx = createTx()
    tx.participacionPartido.findMany.mockResolvedValue([
      { jugadorId: 'player-1', jugadorIdSnapshot: null, ladoMarcador: 'LOCAL' },
    ])
    await expect(writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-other', cantidad: 1 }],
    })).rejects.toThrow('Activa el registro de participantes')
  })

  it('allows a scorer already present in the saved participation history when the feature is disabled', async () => {
    const tx = createTx()
    tx.participacionPartido.findMany.mockResolvedValue([
      { jugadorId: 'player-1', jugadorIdSnapshot: null, ladoMarcador: 'LOCAL' },
    ])
    tx.divisionJugador.findMany.mockResolvedValue([])
    tx.anotacionPartido.findMany.mockResolvedValue([{
      jugadorId: 'player-1', equipoId: 'team-local', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-1', cantidad: 1 }],
    })

    expect(tx.anotacionPartido.createMany).toHaveBeenCalledOnce()
  })

  it('accepts an empty participation list as incomparecencia when enabled', async () => {
    const tx = withParticipationEnabled(createTx())
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      participaciones: [],
    })

    expect(tx.participacionPartido.deleteMany).toHaveBeenCalledOnce()
    expect(tx.participacionPartido.createMany).not.toHaveBeenCalled()
  })

  it('recreates a deleted participant using snapshots and null foreign keys', async () => {
    const tx = withParticipationEnabled(createTx())
    tx.divisionJugador.findMany.mockResolvedValue([])
    tx.participacionPartido.findMany.mockResolvedValue([{
      jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
      participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-deleted' }],
    })

    expect(tx.participacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    })] })
  })

  it('recreates a deleted scorer using snapshots and null foreign keys', async () => {
    const tx = createTx()
    tx.divisionJugador.findMany.mockResolvedValue([])
    tx.anotacionPartido.findMany.mockResolvedValue([{
      jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local', ladoMarcador: 'LOCAL',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    }])

    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0,
      allocations: [{ ladoMarcador: 'LOCAL', jugadorId: 'player-deleted', cantidad: 1 }],
    })

    expect(tx.anotacionPartido.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-deleted', equipoIdSnapshot: 'team-local',
      jugadorNombre: 'Ana histórica', equipoNombre: 'Locales', dorsal: 9,
    })] })
  })

  it('writes notas when the result is finalized', async () => {
    const tx = createTx()
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [], notas: 'Incidencias del partido',
    })

    expect(tx.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notas: 'Incidencias del partido' }),
    }))
  })

  it('clears notas when explicitly set to null', async () => {
    const tx = createTx()
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [], notas: null,
    })

    expect(tx.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notas: null }),
    }))
  })

  it('preserves notas when the client omits the field', async () => {
    const tx = createTx()
    await writeResultInTransaction(tx as any, 'match-1', {
      expectedVersion: 3, estado: 'FINALIZADO', golesLocal: 0, golesVisitante: 0, allocations: [],
    })

    expect(tx.partido.updateMany.mock.calls[0][0].data).not.toHaveProperty('notas')
  })

  it('rejects notas on PROGRAMADO and SUSPENDIDO transitions', async () => {
    const reopened = createTx()
    await expect(writeResultInTransaction(reopened as any, 'match-1', {
      expectedVersion: 3, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, allocations: [], notas: 'Debe conservarse',
    })).rejects.toThrow('Las notas y los participantes solo pueden guardarse al finalizar el partido')

    const suspended = createTx()
    await expect(writeResultInTransaction(suspended as any, 'match-1', {
      expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [], notas: 'Debe conservarse',
    })).rejects.toThrow('Las notas y los participantes solo pueden guardarse al finalizar el partido')
  })
})
