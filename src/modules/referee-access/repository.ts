import { prisma } from '../../config/database'
import type { PartidoRefereeAccessEntity, RefereePartidoReadContext } from './entity'
import type { PartidoRefereeAccessRepository } from './repository.interface'

export const refereeAccessRepository: PartidoRefereeAccessRepository = {
  async findByTokenHash(tokenHash: string): Promise<PartidoRefereeAccessEntity | null> {
    return prisma.partidoRefereeAccess.findUnique({ where: { tokenHash } })
  },

  async findPartidoReadContextByTokenHash(tokenHash: string): Promise<RefereePartidoReadContext | null> {
    return prisma.partidoRefereeAccess.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        usedAt: true,
        partido: {
          select: {
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
            anotaciones: {
              select: { id: true, jugadorId: true, equipoId: true, ladoMarcador: true, cantidad: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
              orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }],
            },
            equipoLocal: { select: { id: true, nombre: true, logo: true } },
            equipoVisitante: { select: { id: true, nombre: true, logo: true } },
            cancha: { select: { id: true, nombre: true } },
            jornada: {
              select: {
                numero: true,
                division: { select: {
                  nombre: true,
                  liga: { select: { nombre: true, multiplesCanchas: true } },
                  jugadores: { select: { equipoId: true, dorsal: true, jugador: { select: { id: true, nombre: true, foto: true } } } },
                } },
              },
            },
            rondaPlayoff: {
              select: {
                division: { select: {
                  nombre: true,
                  liga: { select: { nombre: true, multiplesCanchas: true } },
                  jugadores: { select: { equipoId: true, dorsal: true, jugador: { select: { id: true, nombre: true, foto: true } } } },
                } },
              },
            },
          },
        },
      },
    })
  },

  async findByPartidoId(partidoId: string): Promise<PartidoRefereeAccessEntity | null> {
    return prisma.partidoRefereeAccess.findFirst({ where: { partidoId } })
  },

  async upsert(data: { tokenHash: string; partidoId: string; createdById: string; expiresAt: Date }): Promise<PartidoRefereeAccessEntity> {
    return prisma.partidoRefereeAccess.upsert({
      where: { partidoId: data.partidoId },
      update: { tokenHash: data.tokenHash, createdById: data.createdById, expiresAt: data.expiresAt, usedAt: null },
      create: data,
    })
  },

  async markUsedInTx(tx: any, id: string): Promise<void> {
    await tx.partidoRefereeAccess.update({ where: { id }, data: { usedAt: new Date() } })
  },

  async delete(id: string): Promise<void> {
    await prisma.partidoRefereeAccess.delete({ where: { id } })
  },
}
