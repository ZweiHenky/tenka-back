import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ recalculate: vi.fn(), sync: vi.fn(), groupBy: vi.fn() }))
vi.mock('../tabla-posicion/service', () => ({ tablaPosicionService: { recalcular: mocks.recalculate } }))
vi.mock('../ronda-playoff/service', () => ({ rondaPlayoffService: { syncAdvancement: mocks.sync } }))

import { writeResultInTransaction } from './resultWriter'

const division = {
  id: 'division-1',
  registrarParticipaciones: true,
  registrarGoleo: true,
  minPartidosEliminatoria: 3,
  usarPenalesEnEmpates: false,
  estadoLiga: { codigo: 'EN_CURSO' },
  liga: { id: 'league-1', userId: 'owner-1', multiplesCanchas: false },
}

/** Un partido del cuadro: fecha y hora completas, que es lo que exige finalizar una eliminatoria. */
const partidoDeCuadro = {
  id: 'match-1',
  version: 3,
  estado: 'PROGRAMADO',
  golesLocal: 0,
  golesVisitante: 0,
  penalesLocal: null,
  penalesVisitante: null,
  tipoPartido: 'ELIMINATORIA',
  jornadaId: null,
  rondaPlayoffId: 'ronda-1',
  equipoLocalId: 'team-local',
  equipoVisitanteId: 'team-away',
  fecha: new Date('2026-08-02T18:00:00Z'),
  fechaFin: new Date('2026-08-02T19:00:00Z'),
  canchaId: null,
  jornada: null,
  rondaPlayoff: { division },
}

function createTx(overrides?: { partido?: Record<string, unknown> }) {
  const partido = { ...partidoDeCuadro, ...overrides?.partido }
  return {
    partido: {
      findUnique: vi.fn()
        .mockResolvedValueOnce(partido)
        .mockResolvedValue({ ...partido, version: 4, estado: 'FINALIZADO' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    divisionJugador: {
      findMany: vi.fn().mockResolvedValue([
        { jugadorId: 'novato', equipoId: 'team-local', dorsal: 9, jugador: { nombre: 'Novato' }, equipo: { nombre: 'Locales' } },
        { jugadorId: 'veterano', equipoId: 'team-local', dorsal: 5, jugador: { nombre: 'Veterano' }, equipo: { nombre: 'Locales' } },
      ]),
    },
    jugador: { findMany: vi.fn().mockResolvedValue([{ id: 'novato', nombre: 'Novato' }]) },
    equipo: { findMany: vi.fn().mockResolvedValue([{ id: 'team-local', nombre: 'Locales' }, { id: 'team-away', nombre: 'Visita' }]) },
    rondaPlayoff: { findFirst: vi.fn().mockResolvedValue(null) },
    estadoLiga: { findFirst: vi.fn().mockResolvedValue({ id: 'estado-finalizada' }) },
    division: { update: vi.fn() },
    anotacionPartido: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
    participacionPartido: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      groupBy: mocks.groupBy,
    },
  }
}

const resultado = (extra?: Record<string, unknown>) => ({
  expectedVersion: 3,
  estado: 'FINALIZADO' as const,
  golesLocal: 1,
  golesVisitante: 0,
  allocations: [],
  participaciones: [{ ladoMarcador: 'LOCAL' as const, jugadorId: 'novato' }],
  notas: undefined,
  ...extra,
})

describe('mínimo de partidos para eliminatorias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // "novato" solo tiene 1 partido; el mínimo de la división es 3.
    mocks.groupBy.mockResolvedValue([{ jugadorIdSnapshot: 'novato', _count: { _all: 1 } }])
  })

  it('rechaza alinear a quien no llega, y lo nombra', async () => {
    const tx = createTx()

    await expect(writeResultInTransaction(tx as never, 'match-1', resultado() as never))
      .rejects.toThrow(/Novato \(1\)/)
  })

  /** La excepción del dueño de la liga. */
  it('con permitirInelegibles se guarda igual', async () => {
    const tx = createTx()

    await expect(writeResultInTransaction(tx as never, 'match-1', resultado({ permitirInelegibles: true }) as never))
      .resolves.toBeDefined()
  })

  it('quien sí llega al mínimo pasa sin problema', async () => {
    mocks.groupBy.mockResolvedValue([{ jugadorIdSnapshot: 'veterano', _count: { _all: 5 } }])
    const tx = createTx()

    await expect(writeResultInTransaction(
      tx as never,
      'match-1',
      resultado({ participaciones: [{ ladoMarcador: 'LOCAL', jugadorId: 'veterano' }] }) as never,
    )).resolves.toBeDefined()
  })

  /** El requisito es sobre la fase regular: en un partido de liga no se aplica. */
  it('no se aplica fuera del cuadro', async () => {
    const tx = createTx({ partido: { rondaPlayoffId: null, jornadaId: 'week-1', tipoPartido: 'REGULAR', jornada: { division }, rondaPlayoff: null } })

    await expect(writeResultInTransaction(tx as never, 'match-1', resultado() as never)).resolves.toBeDefined()
    expect(mocks.groupBy).not.toHaveBeenCalled()
  })

  it('con el mínimo en cero no se consulta nada', async () => {
    const tx = createTx({ partido: { rondaPlayoff: { division: { ...division, minPartidosEliminatoria: 0 } } } })

    await expect(writeResultInTransaction(tx as never, 'match-1', resultado() as never)).resolves.toBeDefined()
    expect(mocks.groupBy).not.toHaveBeenCalled()
  })
})
