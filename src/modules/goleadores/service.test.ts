import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ divisionFindFirst: vi.fn(), allocationFindMany: vi.fn() }))
vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst },
    anotacionPartido: { findMany: mocks.allocationFindMany },
  },
}))

import { goleadoresService } from './service'

const row = (overrides: Record<string, unknown>) => ({
  jugadorId: 'player-1', equipoId: 'team-1', ladoMarcador: 'LOCAL', cantidad: 1,
  jugadorNombre: 'Snapshot', equipoNombre: 'Snapshot Team',
  jugador: { nombre: 'Actual', foto: 'photo.jpg' }, equipo: { nombre: 'Current Team' },
  partido: { tipoPartido: 'REGULAR' }, ...overrides,
})

describe('goleadoresService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' })
  })

  it('applies competition side scope, aggregates teams, and returns deterministic sequential ranks', async () => {
    mocks.allocationFindMany.mockResolvedValue([
      row({ cantidad: 2 }),
      row({ equipoId: 'team-2', equipoNombre: 'Second', equipo: null, cantidad: 1, partido: { tipoPartido: 'ELIMINATORIA' } }),
      row({ jugadorId: 'player-2', jugador: null, jugadorNombre: 'Beto', cantidad: 3 }),
      row({ jugadorId: 'ignored', cantidad: 10, partido: { tipoPartido: 'AMISTOSO' } }),
      row({ jugadorId: 'ignored-away', ladoMarcador: 'VISITANTE', cantidad: 10, partido: { tipoPartido: 'COMPLEMENTO' } }),
      row({ jugadorId: null, jugadorNombre: null, jugador: null, cantidad: 4, partido: { tipoPartido: 'COMPLEMENTO' } }),
    ])

    await expect(goleadoresService.findByDivision('division-1')).resolves.toEqual(expect.objectContaining({
      ranking: 'SEQUENTIAL',
      unattributedGoals: 4,
      rows: [
        expect.objectContaining({ rank: 1, jugadorId: 'player-1', nombre: 'Actual', goles: 3, equipos: expect.any(Array) }),
        expect.objectContaining({ rank: 2, jugadorId: 'player-2', nombre: 'Beto', goles: 3 }),
      ],
    }))
  })

  it('hides draft divisions from public callers', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null)
    await expect(goleadoresService.findByDivision('draft')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.allocationFindMany).not.toHaveBeenCalled()
  })
})
