import { NotFoundError } from '../../utils/errors';
import { tipoCompetenciaRepository } from './repository';
import type { TipoCompetenciaEntity } from './entity';

export const tipoCompetenciaService = {
  async list(): Promise<TipoCompetenciaEntity[]> {
    return tipoCompetenciaRepository.findAll();
  },

  async getById(id: string): Promise<TipoCompetenciaEntity> {
    const t = await tipoCompetenciaRepository.findById(id);
    if (!t) throw new NotFoundError('Tipo de competencia');
    return t;
  },

  async create(data: { nombre: string; codigo: string }): Promise<TipoCompetenciaEntity> {
    return tipoCompetenciaRepository.create(data);
  },

  async update(id: string, data: Record<string, unknown>): Promise<TipoCompetenciaEntity> {
    await this.getById(id);
    return tipoCompetenciaRepository.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await tipoCompetenciaRepository.delete(id);
  },
};
