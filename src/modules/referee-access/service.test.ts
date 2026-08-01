import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findReadContext: vi.fn(),
  findByTokenHash: vi.fn(),
  partidoFindById: vi.fn(),
}))

vi.mock('../../config/database', () => ({ prisma: {} }))
vi.mock('./repository', () => ({
  refereeAccessRepository: {
    findPartidoReadContextByTokenHash: mocks.findReadContext,
    findByTokenHash: mocks.findByTokenHash,
  },
}))
vi.mock('../partido/repository', () => ({
  partidoRepository: { findById: mocks.partidoFindById },
}))
vi.mock('../tabla-posicion/service', () => ({ tablaPosicionService: {} }))
vi.mock('../ronda-playoff/service', () => ({ rondaPlayoffService: {} }))

import { refereeAccessService } from './service'

const token = 'a'.repeat(43)
const fecha = new Date('2026-08-01T18:00:00.000Z')
const activeUntil = new Date(Date.now() + 60_000)
const basePartido = {
  id: 'partido-1',
  fecha,
  estado: 'PROGRAMADO',
  golesLocal: 1,
  golesVisitante: 0,
  penalesLocal: null,
  penalesVisitante: null,
  tipoPartido: 'REGULAR',
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
        jornada: { numero: 4, division: { nombre: 'Primera', liga: { nombre: 'Liga Uno' } } },
      },
    })

    await expect(refereeAccessService.getPartidoByToken(`Bearer ${token}`)).resolves.toEqual({
      id: 'partido-1',
      fecha,
      horaInicio: fecha,
      equipoLocal: basePartido.equipoLocal,
      equipoVisitante: basePartido.equipoVisitante,
      cancha: basePartido.cancha,
      estado: 'PROGRAMADO',
      golesLocal: 1,
      golesVisitante: 0,
      penalesLocal: null,
      penalesVisitante: null,
      tipoPartido: 'REGULAR',
      jornadaNumero: 4,
      divisionNombre: 'Primera',
      ligaNombre: 'Liga Uno',
    })
    expect(mocks.findReadContext).toHaveBeenCalledOnce()
    expect(mocks.findReadContext).toHaveBeenCalledWith(crypto.createHash('sha256').update(token).digest('hex'))
    expect(mocks.findByTokenHash).not.toHaveBeenCalled()
    expect(mocks.partidoFindById).not.toHaveBeenCalled()
  })

  it('preserves playoff context and empty competition fallbacks', async () => {
    mocks.findReadContext
      .mockResolvedValueOnce({
        expiresAt: activeUntil,
        usedAt: null,
        partido: {
          ...basePartido,
          tipoPartido: 'ELIMINATORIA',
          rondaPlayoff: { division: { nombre: 'Copa', liga: { nombre: 'Liga Dos' } } },
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
