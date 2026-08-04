import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock('../../config/database', () => ({
  prisma: { partidoRefereeAccess: { findUnique: mocks.findUnique } },
}))

import { refereeAccessRepository } from './repository'

describe('refereeAccessRepository.findPartidoReadContextByTokenHash', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the complete referee read context in one Prisma operation', async () => {
    mocks.findUnique.mockResolvedValue(null)

    await refereeAccessRepository.findPartidoReadContextByTokenHash('token-hash')

    expect(mocks.findUnique).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tokenHash: 'token-hash' },
      select: expect.objectContaining({
        expiresAt: true,
        usedAt: true,
        partido: expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            version: true,
            fecha: true,
            fechaFin: true,
            canchaId: true,
            estado: true,
            golesLocal: true,
            golesVisitante: true,
            penalesLocal: true,
            penalesVisitante: true,
            tipoPartido: true,
            equipoLocal: { select: { id: true, nombre: true, logo: true } },
            equipoVisitante: { select: { id: true, nombre: true, logo: true } },
            cancha: { select: { id: true, nombre: true } },
            jornada: {
              select: {
                numero: true,
                division: expect.any(Object),
              },
            },
            rondaPlayoff: {
              select: {
                division: expect.any(Object),
              },
            },
          }),
        }),
      }),
    }))
  })
})
