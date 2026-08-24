import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  divisionFindFirst: vi.fn(),
  divisionJugadorFindMany: vi.fn(),
  groupBy: vi.fn(),
}))
vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst },
    divisionJugador: { findMany: mocks.divisionJugadorFindMany },
    participacionPartido: { groupBy: mocks.groupBy },
  },
}))

import { contarPartidosJugados, elegibilidadService, participacionesQueCuentan } from './service'

describe('participacionesQueCuentan', () => {
  const where = participacionesQueCuentan('division-1')

  it('solo la fase regular y solo partidos finalizados', () => {
    expect(where.partido).toMatchObject({
      estado: 'FINALIZADO',
      rondaPlayoffId: null,
      jornada: { divisionId: 'division-1' },
    })
  })

  /**
   * La decisión que hay que no perder: en un complemento solo suma el equipo de puntos, igual que
   * en `tablaPosicion.recalcular`, donde el visitante "repite sin puntos" y no recibe nada. Los
   * amistosos no aparecen en ninguna rama, así que quedan fuera.
   */
  it('del complemento solo cuenta el equipo que suma puntos', () => {
    expect(where.OR).toEqual([
      { partido: { tipoPartido: 'REGULAR' } },
      { partido: { tipoPartido: 'COMPLEMENTO' }, ladoMarcador: 'LOCAL' },
    ])
  })
})

describe('contarPartidosJugados', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin jugadores no consulta nada', async () => {
    const tx = { participacionPartido: { groupBy: mocks.groupBy } }
    await expect(contarPartidosJugados(tx as never, 'division-1', [])).resolves.toEqual(new Map())
    expect(mocks.groupBy).not.toHaveBeenCalled()
  })

  /** Se agrupa por el snapshot porque es el que sobrevive a la baja del jugador. */
  it('agrupa por jugadorIdSnapshot y devuelve el conteo', async () => {
    mocks.groupBy.mockResolvedValue([
      { jugadorIdSnapshot: 'j1', _count: { _all: 4 } },
      { jugadorIdSnapshot: 'j2', _count: { _all: 1 } },
    ])
    const tx = { participacionPartido: { groupBy: mocks.groupBy } }

    const conteo = await contarPartidosJugados(tx as never, 'division-1', ['j1', 'j2', 'j3'])

    expect(mocks.groupBy.mock.calls[0][0].by).toEqual(['jugadorIdSnapshot'])
    expect(conteo.get('j1')).toBe(4)
    expect(conteo.get('j2')).toBe(1)
    expect(conteo.get('j3')).toBeUndefined()
  })
})

describe('elegibilidadService.findByDivision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.divisionJugadorFindMany.mockResolvedValue([
      { jugadorId: 'j1', equipoId: 'e1', jugador: { nombre: 'Ana' }, equipo: { nombre: 'Rojos' } },
      { jugadorId: 'j2', equipoId: 'e1', jugador: { nombre: 'Beto' }, equipo: { nombre: 'Rojos' } },
    ])
    mocks.groupBy.mockResolvedValue([{ jugadorIdSnapshot: 'j1', _count: { _all: 3 } }])
  })

  it('marca elegibles según el mínimo de la división', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'd1', minPartidosEliminatoria: 3, registrarParticipaciones: true })

    const { minimo, rows } = await elegibilidadService.findByDivision('d1')

    expect(minimo).toBe(3)
    expect(rows).toEqual([
      { jugadorId: 'j1', nombre: 'Ana', equipoId: 'e1', equipoNombre: 'Rojos', partidosJugados: 3, elegible: true },
      { jugadorId: 'j2', nombre: 'Beto', equipoId: 'e1', equipoNombre: 'Rojos', partidosJugados: 0, elegible: false },
    ])
  })

  /**
   * Sin registro de participantes no existe el dato de quién jugó, así que exigir un mínimo dejaría
   * fuera al plantel entero. El requisito se ignora en vez de aplicarse sobre datos que no hay.
   */
  it('sin registrar participaciones el mínimo no aplica', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'd1', minPartidosEliminatoria: 5, registrarParticipaciones: false })

    const { minimo, rows } = await elegibilidadService.findByDivision('d1')

    expect(minimo).toBe(0)
    expect(rows.every((fila) => fila.elegible)).toBe(true)
  })
})
