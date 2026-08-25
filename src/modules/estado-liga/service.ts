import { NotFoundError, ValidationError } from '../../utils/errors';
import { estadoLigaRepository } from './repository';
import { ESTADOS_LIGA, type EstadoLigaEntity } from './entity';

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

  async update(id: string, data: { nombre?: string }): Promise<EstadoLigaEntity> {
    await this.getById(id);
    return estadoLigaRepository.update(id, { nombre: data.nombre });
  },

  async delete(id: string): Promise<void> {
    const estado = await this.getById(id);
    if ((ESTADOS_LIGA as readonly string[]).includes(estado.codigo)) {
      throw new ValidationError('No se puede eliminar un estado canónico de liga');
    }
    await estadoLigaRepository.delete(id);
  },
};
