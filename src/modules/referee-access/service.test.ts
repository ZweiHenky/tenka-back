import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findReadContext: vi.fn(),
  findByTokenHash: vi.fn(),
  partidoFindById: vi.fn(),
  transaction: vi.fn(),
  executeRawUnsafe: vi.fn(),
  accessFindUnique: vi.fn(),
  accessUpdate: vi.fn(),
  partidoFindUnique: vi.fn(),
  partidoUpdate: vi.fn(),
}))

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    partidoRefereeAccess: { findUnique: mocks.accessFindUnique },
    partido: { findUnique: mocks.partidoFindUnique },
  },
}))
vi.mock('./repository', () => ({
  refereeAccessRepository: {
    findPartidoReadContextByTokenHash: mocks.findReadContext,
    findByTokenHash: mocks.findByTokenHash,
  },
}))
vi.mock('../partido/repository', () => ({
  partidoRepository: { findById: mocks.partidoFindById },
  exposeAnotacionRead: (annotation: any) => annotation,
  exposeParticipacionRead: (participacion: any) => participacion,
}))
vi.mock('../tabla-posicion/service', () => ({ tablaPosicionService: {} }))
vi.mock('../ronda-playoff/service', () => ({ rondaPlayoffService: {} }))

import { refereeAccessService } from './service'

const token = 'a'.repeat(43)
const fecha = new Date('2026-08-01T18:00:00.000Z')
const activeUntil = new Date(Date.now() + 60_000)
const basePartido = {
  id: 'partido-1',
  version: 0,
  fecha,
  fechaFin: new Date('2026-08-01T19:00:00.000Z'),
  canchaId: 'cancha-1',
  estado: 'PROGRAMADO',
  golesLocal: 1,
  golesVisitante: 0,
  penalesLocal: null,
  penalesVisitante: null,
  tipoPartido: 'REGULAR',
  anotaciones: [],
  participaciones: [],
  equipoLocal: { id: 'local-1', nombre: 'Locales', logo: 'local.png' },
  equipoVisitante: { id: 'visitante-1', nombre: 'Visitantes', logo: null },
  cancha: { id: 'cancha-1', nombre: 'Cancha Central' },
  jornada: null,
  rondaPlayoff: null,
}

describe('refereeAccessService.getPartidoByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findReadContext.mockResolvedValue({ expiresAt: activeUntil, usedAt: null, partido: basePartido })
  })

  it('preserves aliases and jornada context using one repository operation', async () => {
    mocks.findReadContext.mockResolvedValue({
      expiresAt: activeUntil,
      usedAt: null,
      partido: {
        ...basePartido,
        jornada: { numero: 4, division: { nombre: 'Primera', registrarParticipaciones: false, liga: { nombre: 'Liga Uno', multiplesCanchas: true }, jugadores: [] } },
      },
    })

    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toEqual({
      id: 'partido-1',
      fecha,
      fechaFin: basePartido.fechaFin,
      horaInicio: fecha,
      equipoLocal: basePartido.equipoLocal,
      equipoVisitante: basePartido.equipoVisitante,
      cancha: basePartido.cancha,
      canchaId: 'cancha-1',
      multiplesCanchas: true,
      estado: 'PROGRAMADO',
      version: 0,
      golesLocal: 1,
      golesVisitante: 0,
      penalesLocal: null,
      penalesVisitante: null,
      tipoPartido: 'REGULAR',
      notas: undefined,
      anotaciones: [],
      participaciones: [],
      registrarParticipaciones: false,
      usarPenalesEnEmpates: true,
      jugadoresLocal: [],
      jugadoresVisitante: [],
      jornadaNumero: 4,
      divisionNombre: 'Primera',
      ligaNombre: 'Liga Uno',
    })
    expect(mocks.findReadContext).toHaveBeenCalledOnce()
    expect(mocks.findReadContext).toHaveBeenCalledWith(crypto.createHash('sha256').update(token).digest('hex'))
    expect(mocks.findByTokenHash).not.toHaveBeenCalled()
    expect(mocks.partidoFindById).not.toHaveBeenCalled()
  })

  it('exposes the private notes of the match to the referee', async () => {
    mocks.findReadContext.mockResolvedValue({
      expiresAt: activeUntil,
      usedAt: null,
      partido: { ...basePartido, notas: 'Incidencias del partido' },
    })

    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toMatchObject({
      notas: 'Incidencias del partido',
    })
  })

  it('preserves playoff context and empty competition fallbacks', async () => {
    mocks.findReadContext
      .mockResolvedValueOnce({
        expiresAt: activeUntil,
        usedAt: null,
        partido: {
          ...basePartido,
          tipoPartido: 'ELIMINATORIA',
          rondaPlayoff: { division: { nombre: 'Copa', registrarParticipaciones: false, liga: { nombre: 'Liga Dos', multiplesCanchas: false }, jugadores: [] } },
        },
      })
      .mockResolvedValueOnce({ expiresAt: activeUntil, usedAt: null, partido: basePartido })

    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toMatchObject({
      jornadaNumero: null,
      divisionNombre: 'Copa',
      ligaNombre: 'Liga Dos',
    })
    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toMatchObject({
      jornadaNumero: null,
      divisionNombre: '',
      ligaNombre: '',
    })
    expect(mocks.findReadContext).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['missing', null],
    ['used', { expiresAt: activeUntil, usedAt: new Date(), partido: basePartido }],
    ['expired', { expiresAt: new Date(0), usedAt: null, partido: basePartido }],
  ])('keeps the generic 422 error for %s access', async (_case, access) => {
    mocks.findReadContext.mockResolvedValue(access)

    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Enlace no válido o expirado',
    })
  })

  it.each([undefined, 'Basic value', 'Bearer short'])('keeps malformed authorization errors generic', async (header) => {
    await expect(refereeAccessService.getPartidoByToken(header)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Token de acceso no válido',
    })
    expect(mocks.findReadContext).not.toHaveBeenCalled()
  })

  it('preserves the partido 404 for an absent joined partido', async () => {
    mocks.findReadContext.mockResolvedValue({ expiresAt: activeUntil, usedAt: null, partido: null })

    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Partido no encontrado',
    })
  })
})

describe('refereeAccessService.updateResultByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const tx = {
      $executeRawUnsafe: mocks.executeRawUnsafe,
      partidoRefereeAccess: {
        findUnique: mocks.accessFindUnique,
        update: mocks.accessUpdate,
      },
      partido: {
        findUnique: mocks.partidoFindUnique,
        update: mocks.partidoUpdate,
      },
    }
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx))
    mocks.accessFindUnique.mockResolvedValue({
      id: 'access-1',
      partidoId: 'partido-1',
      expiresAt: activeUntil,
      usedAt: null,
    })
    mocks.partidoFindUnique.mockResolvedValue({
      id: 'partido-1',
      version: 0,
      estado: 'PROGRAMADO',
      rondaPlayoffId: 'round-1',
      jornadaId: null,
      fecha: null,
      fechaFin: null,
      canchaId: null,
      jornada: null,
      rondaPlayoff: {
        division: { id: 'division-1', liga: { id: 'liga-1', userId: 'owner-1', multiplesCanchas: false } },
      },
    })
  })

  it('rejects an unscheduled playoff without consuming the token or updating the match', async () => {
    await expect(refereeAccessService.updateResultByToken(`Bearer ${token}`, {
      estado: 'FINALIZADO',
      expectedVersion: 0,
      golesLocal: 2,
      golesVisitante: 1,
      allocations: [],
    })).rejects.toThrow('primero genera la jornada')

    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'liga-1',
    )
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' })
    expect(mocks.partidoFindUnique).toHaveBeenCalledTimes(3)
    expect(mocks.executeRawUnsafe.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.accessFindUnique.mock.invocationCallOrder[1])
    expect(mocks.executeRawUnsafe.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.partidoFindUnique.mock.invocationCallOrder[1])
    expect(mocks.partidoUpdate).not.toHaveBeenCalled()
    expect(mocks.accessUpdate).not.toHaveBeenCalled()
  })

  it('uses the post-lock participation flag when it changed while waiting', async () => {
    const resultContext = (registrarParticipaciones: boolean) => ({
      id: 'partido-1', version: 0, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0,
      penalesLocal: null, penalesVisitante: null, jornadaId: 'jornada-1', rondaPlayoffId: null,
      equipoLocalId: 'local-1', equipoVisitanteId: 'visitante-1', fecha, fechaFin: basePartido.fechaFin, canchaId: 'cancha-1',
      jornada: {
        division: {
          id: 'division-1', registrarParticipaciones,
          liga: { id: 'liga-1', userId: 'owner-1', multiplesCanchas: false },
        },
      },
      rondaPlayoff: null,
    })
    mocks.partidoFindUnique
      .mockReset()
      .mockResolvedValueOnce(resultContext(false))
      .mockResolvedValueOnce(resultContext(true))
      .mockResolvedValueOnce(resultContext(true))

    await expect(refereeAccessService.updateResultByToken(`Bearer ${token}`, {
      estado: 'FINALIZADO', expectedVersion: 0, golesLocal: 0, golesVisitante: 0, allocations: [],
    })).rejects.toThrow('Debes registrar los jugadores que participaron')

    expect(mocks.executeRawUnsafe.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.partidoFindUnique.mock.invocationCallOrder[1])
    expect(mocks.accessUpdate).not.toHaveBeenCalled()
  })
})
