import { prisma } from '../../config/database';
import type { RondaPlayoffEntity, RondaPlayoffReadEntity } from './entity';
import type { RondaPlayoffRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import { exposePartidoRead, PARTIDO_READ_INCLUDE } from '../partido/repository';

export const rondaPlayoffRepository: RondaPlayoffRepository = {
  async findAll(): Promise<RondaPlayoffEntity[]> {
    return prisma.rondaPlayoff.findMany();
  },

  async findById(id: string): Promise<RondaPlayoffEntity | null> {
    return prisma.rondaPlayoff.findUnique({ where: { id } });
  },

  async findVisibleById(id: string, actor?: AuthenticatedUser): Promise<RondaPlayoffEntity | null> {
    return prisma.rondaPlayoff.findFirst({
      where: { id, division: visibleDivisionWhere(actor) },
    });
  },

  async findByDivision(divisionId: string): Promise<RondaPlayoffEntity[]> {
    return prisma.rondaPlayoff.findMany({ where: { divisionId }, orderBy: { orden: 'asc' } });
  },

  async findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<RondaPlayoffReadEntity[] | null> {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: {
        rondasPlayoff: {
          orderBy: { orden: 'asc' },
          include: { partidos: { include: PARTIDO_READ_INCLUDE } },
        },
      },
    });
    return division?.rondasPlayoff.map((ronda) => ({
      ...ronda,
      partidos: ronda.partidos.map(exposePartidoRead),
    })) ?? null;
  },

  async create(data: Record<string, unknown>): Promise<RondaPlayoffEntity> {
    return prisma.rondaPlayoff.create({ data: data as any });
  },

  async update(id: string, data: Record<string, unknown>): Promise<RondaPlayoffEntity> {
    return prisma.rondaPlayoff.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.rondaPlayoff.delete({ where: { id } });
  },

  async deleteByDivision(divisionId: string): Promise<void> {
    await prisma.rondaPlayoff.deleteMany({ where: { divisionId } });
  },
};
