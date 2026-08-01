import { NotFoundError } from '../../utils/errors';
import { tipoRepository } from './repository';
import type { TipoEntity } from './entity';
export const tipoService = {
  async list(): Promise<TipoEntity[]> { return tipoRepository.findAll(); },
  async getById(id: string): Promise<TipoEntity> { const t = await tipoRepository.findById(id); if (!t) throw new NotFoundError('Tipo'); return t; },
  async create(data: { nombre: string }): Promise<TipoEntity> { return tipoRepository.create(data); },
  async update(id: string, data: Record<string, unknown>): Promise<TipoEntity> { await this.getById(id); return tipoRepository.update(id, data); },
  async delete(id: string): Promise<void> { await this.getById(id); await tipoRepository.delete(id); },
};
