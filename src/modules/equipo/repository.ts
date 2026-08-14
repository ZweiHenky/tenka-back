import { prisma } from '../../config/database';
import type { EquipoEntity } from './entity';
import type { EquipoRepository } from './repository.interface';
import type { Prisma } from '../../generated/prisma/client';

export const equipoRepository: EquipoRepository = {
  async findAll(): Promise<EquipoEntity[]> {
    return prisma.equipo.findMany({ orderBy: { nombre: 'asc' } });
  },

  async findAllPaginated({ skip, take }): Promise<{ rows: EquipoEntity[]; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.equipo.findMany({ orderBy: { nombre: 'asc' }, skip, take }),
      prisma.equipo.count(),
    ]);
    return { rows, total };
  },

  async findByUser(userId: string): Promise<EquipoEntity[]> {
    return prisma.equipo.findMany({ where: { userId }, orderBy: { nombre: 'asc' } });
  },

  async findById(id: string): Promise<EquipoEntity | null> {
    return prisma.equipo.findUnique({ where: { id } });
  },

  async findByNormalizedName(userId: string, nombreNormalizado: string, excludeId?: string): Promise<EquipoEntity | null> {
    return prisma.equipo.findFirst({
      where: { userId, nombreNormalizado, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
  },

  async create(data: { nombre: string; nombreNormalizado: string; logo?: string; userId: string }, tx?: Prisma.TransactionClient): Promise<EquipoEntity> {
    return (tx ?? prisma).equipo.create({ data });
  },

  async update(id: string, data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<EquipoEntity> {
    return (tx ?? prisma).equipo.update({ where: { id }, data });
  },

  async delete(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? prisma).equipo.delete({ where: { id } });
  },
};
