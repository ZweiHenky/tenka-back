import { prisma } from '../../config/database';
import type { CategoriaEntity } from './entity';
import type { CategoriaRepository } from './repository.interface';

export const categoriaRepository: CategoriaRepository = {
  async findAll(): Promise<CategoriaEntity[]> {
    return prisma.categoria.findMany({ orderBy: { nombre: 'asc' } });
  },

  async findById(id: string): Promise<CategoriaEntity | null> {
    return prisma.categoria.findUnique({ where: { id } });
  },

  async create(data: { nombre: string }): Promise<CategoriaEntity> {
    return prisma.categoria.create({ data });
  },

  async update(id: string, data: Record<string, unknown>): Promise<CategoriaEntity> {
    return prisma.categoria.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.categoria.delete({ where: { id } });
  },
};
