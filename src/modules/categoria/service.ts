import { NotFoundError } from '../../utils/errors';
import { categoriaRepository } from './repository';
import type { CategoriaEntity } from './entity';

export const categoriaService = {
  async list(): Promise<CategoriaEntity[]> {
    return categoriaRepository.findAll();
  },

  async getById(id: string): Promise<CategoriaEntity> {
    const categoria = await categoriaRepository.findById(id);
    if (!categoria) throw new NotFoundError('Categoría');
    return categoria;
  },

  async create(data: { nombre: string }): Promise<CategoriaEntity> {
    return categoriaRepository.create(data);
  },

  async update(id: string, data: { nombre?: string }): Promise<CategoriaEntity> {
    await this.getById(id);
    return categoriaRepository.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await categoriaRepository.delete(id);
  },
};
