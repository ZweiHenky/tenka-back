import { NotFoundError } from '../../utils/errors';
import { ubicacionRepository } from './repository';
import type { UbicacionEntity } from './entity';
import type { Pagination } from '../../utils/pagination';

export const ubicacionService = {
  async list(): Promise<UbicacionEntity[]> {
    return ubicacionRepository.findAll();
  },

  async listPaginated(pagination: Pagination) {
    return ubicacionRepository.findAllPaginated(pagination);
  },

  async getById(id: string): Promise<UbicacionEntity> {
    const t = await ubicacionRepository.findById(id);
    if (!t) throw new NotFoundError('Ubicación');
    return t;
  },

  async findOrCreate(data: { lat: number; lng: number; nombreCompleto: string; estado: string; municipio: string }): Promise<UbicacionEntity> {
    return ubicacionRepository.findOrCreate(data);
  },

  async create(data: { lat: number; lng: number; nombreCompleto: string; estado: string; municipio: string }): Promise<UbicacionEntity> {
    return ubicacionRepository.create(data);
  },

  async update(id: string, data: Record<string, unknown>): Promise<UbicacionEntity> {
    await this.getById(id);
    return ubicacionRepository.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await ubicacionRepository.delete(id);
  },
};
