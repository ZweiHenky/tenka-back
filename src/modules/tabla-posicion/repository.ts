import { prisma } from '../../config/database';
import type { TablaPosicionEntity } from './entity';
import type { TablaPosicionRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

export const tablaPosicionRepository: TablaPosicionRepository = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser) {
    return prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: {
        tablaPosiciones: {
          include: { equipo: { select: { id: true, nombre: true, logo: true } } },
          orderBy: { puntos: 'desc' },
        },
        equipos: {
          select: {
            equipoId: true,
            equipo: { select: { id: true, nombre: true, logo: true } },
          },
        },
      },
    });
  },

  async findOne(divisionId: string, equipoId: string, actor?: AuthenticatedUser) {
    return prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: {
        tablaPosiciones: { where: { equipoId } },
      },
    });
  },

  async upsert(divisionId: string, equipoId: string, data: Record<string, unknown>): Promise<TablaPosicionEntity> {
    return prisma.tablaPosicion.upsert({
      where: { divisionId_equipoId: { divisionId, equipoId } },
      create: { divisionId, equipoId, ...data } as any,
      update: data,
    });
  },

  async delete(divisionId: string, equipoId: string): Promise<void> {
    await prisma.tablaPosicion.delete({ where: { divisionId_equipoId: { divisionId, equipoId } } });
  },
};
