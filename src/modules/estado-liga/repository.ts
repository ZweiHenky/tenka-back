import { prisma } from '../../config/database';
import type { EstadoLigaEntity } from './entity';
import type { EstadoLigaRepository } from './repository.interface';

export const estadoLigaRepository: EstadoLigaRepository = {
  async findAll(): Promise<EstadoLigaEntity[]> {
    return prisma.estadoLiga.findMany({ orderBy: { nombre: 'asc' } });
  },

  async findById(id: string): Promise<EstadoLigaEntity | null> {
    return prisma.estadoLiga.findUnique({ where: { id } });
  },

  async create(data: { nombre: string }): Promise<EstadoLigaEntity> {
    return prisma.estadoLiga.create({ data });
  },

  async update(id: string, data: Record<string, unknown>): Promise<EstadoLigaEntity> {
    return prisma.estadoLiga.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.estadoLiga.delete({ where: { id } });
  },
};
