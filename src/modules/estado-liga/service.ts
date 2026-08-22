import { NotFoundError } from '../../utils/errors';
import { estadoLigaRepository } from './repository';
import type { EstadoLigaEntity } from './entity';

export const estadoLigaService = {
  async list(): Promise<EstadoLigaEntity[]> {
    return estadoLigaRepository.findAll();
  },

  async getById(id: string): Promise<EstadoLigaEntity> {
    const t = await estadoLigaRepository.findById(id);
    if (!t) throw new NotFoundError('Estado de liga');
    return t;
  },

  async create(data: { nombre: string; codigo: string }): Promise<EstadoLigaEntity> {
    return estadoLigaRepository.create(data);
  },

  async update(id: string, data: Record<string, unknown>): Promise<EstadoLigaEntity> {
    await this.getById(id);
    return estadoLigaRepository.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await estadoLigaRepository.delete(id);
  },
};
