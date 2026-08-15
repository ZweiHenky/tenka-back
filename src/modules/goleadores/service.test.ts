import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ divisionFindFirst: vi.fn(), queryRaw: vi.fn() }))
vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst },
    $queryRaw: mocks.queryRaw,
  },
}))

import { goleadoresService } from './service'

describe('goleadoresService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' })
  })

  it('uses one parameterized aggregate query and preserves deterministic sequential ranking', async () => {
    mocks.queryRaw.mockResolvedValue([
      { jugadorId: 'player-1', playerKey: 'player-1', nombre: 'Actual', foto: 'photo.jpg', equipoId: 'team-1', teamKey: 'team-1', equipoNombre: 'Current Team', golesEquipo: 2n, golesJugador: 3n, unattributedGoals: 4n },
      { jugadorId: 'player-1', playerKey: 'player-1', nombre: 'Actual', foto: 'photo.jpg', equipoId: 'team-2', teamKey: 'team-2', equipoNombre: 'Second', golesEquipo: 1n, golesJugador: 3n, unattributedGoals: 4n },
      { jugadorId: 'player-2', playerKey: 'player-2', nombre: 'Beto', foto: null, equipoId: 'team-1', teamKey: 'team-1', equipoNombre: 'Current Team', golesEquipo: 3n, golesJugador: 3n, unattributedGoals: 4n },
    ])

    const result = await goleadoresService.findByDivision('division-1')

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    const query = mocks.queryRaw.mock.calls[0][0]
    expect(query.values).toEqual(['division-1', 'division-1'])
    expect(query.strings.join('')).toContain('SUM(cantidad)')
    expect(result).toEqual(expect.objectContaining({
      ranking: 'SEQUENTIAL',
      unattributedGoals: 4,
      rows: [
        expect.objectContaining({ rank: 1, jugadorId: 'player-1', nombre: 'Actual', goles: 3, equipos: [
          expect.objectContaining({ equipoId: 'team-1', goles: 2 }),
          expect.objectContaining({ equipoId: 'team-2', goles: 1 }),
        ] }),
        expect.objectContaining({ rank: 2, jugadorId: 'player-2', nombre: 'Beto', goles: 3 }),
      ],
    }))
  })

  it('returns unattributed goals when no player has attributed goals', async () => {
    mocks.queryRaw.mockResolvedValue([{ jugadorId: null, playerKey: null, nombre: null, foto: null, equipoId: null, teamKey: null, equipoNombre: null, golesEquipo: null, golesJugador: null, unattributedGoals: 5n }])
    await expect(goleadoresService.findByDivision('division-1')).resolves.toEqual({
      divisionId: 'division-1', ranking: 'SEQUENTIAL', rows: [], unattributedGoals: 5,
    })
  })

  it('hides draft divisions from public callers', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null)
    await expect(goleadoresService.findByDivision('draft')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })
})
