import { prisma } from '../../config/database';
import type { PremioEntity } from './entity';
import type { PremioRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

export const premioRepository: PremioRepository = {
  async findAll(): Promise<PremioEntity[]> {
    return prisma.premio.findMany();
  },

  async findById(id: string): Promise<PremioEntity | null> {
    return prisma.premio.findUnique({ where: { id } });
  },

  async findVisibleById(id: string, actor?: AuthenticatedUser): Promise<PremioEntity | null> {
    return prisma.premio.findFirst({
      where: { id, division: visibleDivisionWhere(actor) },
    });
  },

  async findByDivision(divisionId: string): Promise<PremioEntity[]> {
    return prisma.premio.findMany({ where: { divisionId }, orderBy: { posicion: 'asc' } });
  },

  async findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<PremioEntity[] | null> {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: { premios: { orderBy: { posicion: 'asc' } } },
    });
    return division?.premios ?? null;
  },

  async create(data: { posicion: number; titulo: string; monto?: number; descripcion?: string; divisionId: string }): Promise<PremioEntity> {
    return prisma.premio.create({ data });
  },

  async update(id: string, data: Record<string, unknown>): Promise<PremioEntity> {
    return prisma.premio.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.premio.delete({ where: { id } });
  },
};
