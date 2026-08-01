import { prisma } from '../../config/database';
import type { EquipoEntity } from './entity';
import type { EquipoRepository } from './repository.interface';

export const equipoRepository: EquipoRepository = {
  async findAll(): Promise<EquipoEntity[]> {
    return prisma.equipo.findMany({ orderBy: { nombre: 'asc' } });
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

  async create(data: { nombre: string; nombreNormalizado: string; logo?: string; userId: string }): Promise<EquipoEntity> {
    return prisma.equipo.create({ data });
  },

  async update(id: string, data: Record<string, unknown>): Promise<EquipoEntity> {
    return prisma.equipo.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.equipo.delete({ where: { id } });
  },
};
