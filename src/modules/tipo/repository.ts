import { prisma } from '../../config/database';
import type { TipoEntity } from './entity';
import type { TipoRepository } from './repository.interface';

export const tipoRepository: TipoRepository = {
  async findAll(): Promise<TipoEntity[]> { return prisma.tipo.findMany({ orderBy: { nombre: 'asc' } }); },
  async findById(id: string): Promise<TipoEntity | null> { return prisma.tipo.findUnique({ where: { id } }); },
  async create(data: { nombre: string }): Promise<TipoEntity> { return prisma.tipo.create({ data }); },
  async update(id: string, data: Record<string, unknown>): Promise<TipoEntity> { return prisma.tipo.update({ where: { id }, data }); },
  async delete(id: string): Promise<void> { await prisma.tipo.delete({ where: { id } }); },
};
