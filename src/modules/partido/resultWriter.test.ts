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
  jornadaId: 'week-1',
  rondaPlayoffId: null,
  equipoLocalId: 'team-local',
  equipoVisitanteId: 'team-away',
  fecha: new Date('2026-08-02T18:00:00Z'),
  fechaFin: new Date('2026-08-02T19:00:00Z'),
  canchaId: null,
  jornada: { division: { id: 'division-1', liga: { id: 'league-1', userId: 'owner-1', multiplesCanchas: false } } },
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
  }
}

describe('writeResultInTransaction', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('clears allocations on PROGRAMADO and retains them on SUSPENDIDO', async () => {
    const reopened = createTx()
    await writeResultInTransaction(reopened as any, 'match-1', {
      expectedVersion: 3, estado: 'PROGRAMADO', golesLocal: 9, golesVisitante: 9, allocations: [],
    })
    expect(reopened.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ golesLocal: 0, golesVisitante: 0 }) }))
    expect(reopened.anotacionPartido.deleteMany).toHaveBeenCalledOnce()

    const suspended = createTx()
    await writeResultInTransaction(suspended as any, 'match-1', {
      expectedVersion: 3, estado: 'SUSPENDIDO', golesLocal: 2, golesVisitante: 1, allocations: [],
    })
    expect(suspended.anotacionPartido.deleteMany).not.toHaveBeenCalled()
    expect(suspended.anotacionPartido.createMany).not.toHaveBeenCalled()
    expect(suspended.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ golesLocal: 2, golesVisitante: 1 }),
    }))
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
})
