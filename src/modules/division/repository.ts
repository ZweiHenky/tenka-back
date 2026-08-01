import { prisma } from '../../config/database';
import type { DivisionEntity } from './entity';
import type { DivisionRepository } from './repository.interface';
import type { Prisma } from '../../generated/prisma/client';

export const divisionRepository: DivisionRepository = {
  async findAll(): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async findById(id: string): Promise<DivisionEntity | null> {
    return prisma.division.findUnique({
      where: { id },
      include: {
        liga: { select: { id: true, nombre: true, logo: true } },
        estadoLiga: { select: { id: true, nombre: true } },
      },
    }) as any;
  },

  async findByLiga(ligaId: string): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ where: { ligaId }, orderBy: { createdAt: 'desc' } });
  },

  async create(data: Record<string, unknown>): Promise<DivisionEntity> {
    return prisma.division.create({ data: data as any });
  },

  async update(id: string, data: Record<string, unknown>): Promise<DivisionEntity> {
    return prisma.division.update({ where: { id }, data });
  },

  async delete(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? prisma).division.delete({ where: { id } });
  },
};
