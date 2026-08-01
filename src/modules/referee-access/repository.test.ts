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
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'token-hash' },
      select: {
        expiresAt: true,
        usedAt: true,
        partido: {
          select: {
            id: true,
            fecha: true,
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
                division: { select: { nombre: true, liga: { select: { nombre: true } } } },
              },
            },
            rondaPlayoff: {
              select: {
                division: { select: { nombre: true, liga: { select: { nombre: true } } } },
              },
            },
          },
        },
      },
    })
  })
})
