import { prisma } from '../../config/database';
import type { TipoCompetenciaEntity } from './entity';
import type { TipoCompetenciaRepository } from './repository.interface';

export const tipoCompetenciaRepository: TipoCompetenciaRepository = {
  async findAll(): Promise<TipoCompetenciaEntity[]> {
    return prisma.tipoCompetencia.findMany({ orderBy: { nombre: 'asc' } });
  },

  async findById(id: string): Promise<TipoCompetenciaEntity | null> {
    return prisma.tipoCompetencia.findUnique({ where: { id } });
  },

  async create(data: { nombre: string }): Promise<TipoCompetenciaEntity> {
    return prisma.tipoCompetencia.create({ data });
  },

  async update(id: string, data: Record<string, unknown>): Promise<TipoCompetenciaEntity> {
    return prisma.tipoCompetencia.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.tipoCompetencia.delete({ where: { id } });
  },
};
