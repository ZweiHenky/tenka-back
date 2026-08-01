import { ConflictError, NotFoundError } from '../../utils/errors';
import { equipoRepository } from './repository';
import { mediaService } from '../media/service';
import type { EquipoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';

const DUPLICATE_NAME_MESSAGE = 'Ya tienes un equipo con ese nombre';

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export const equipoService = {
  async list(): Promise<EquipoEntity[]> {
    return equipoRepository.findAll();
  },

  async listByUser(userId: string): Promise<EquipoEntity[]> {
    return equipoRepository.findByUser(userId);
  },

  async getById(id: string): Promise<EquipoEntity> {
    const t = await equipoRepository.findById(id);
    if (!t) throw new NotFoundError('Equipo');
    return t;
  },

  async create(data: { nombre: string; logo?: string; logoPublicId?: string; userId: string }): Promise<EquipoEntity> {
    const nombre = data.nombre.trim();
    const nombreNormalizado = nombre.toLowerCase();
    if (await equipoRepository.findByNormalizedName(data.userId, nombreNormalizado)) {
      throw new ConflictError(DUPLICATE_NAME_MESSAGE);
    }
    try {
      return await equipoRepository.create({ ...data, nombre, nombreNormalizado });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
  },

  async update(id: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<EquipoEntity> {
    const old = await this.getById(id);
    assertOwnerOrAdmin(actor, old.userId, 'Equipo');
    const updateData = { ...data };
    if (typeof data.nombre === 'string') {
      const nombre = data.nombre.trim();
      const nombreNormalizado = nombre.toLowerCase();
      updateData.nombre = nombre;
      updateData.nombreNormalizado = nombreNormalizado;
      if (await equipoRepository.findByNormalizedName(old.userId, nombreNormalizado, id)) {
        throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      }
    }
    let updated: EquipoEntity;
    try {
      updated = await equipoRepository.update(id, updateData);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
    if (data.logo !== undefined && data.logo !== old.logo) {
      await mediaService.scheduleImageCleanup(old.logo, old.logoPublicId);
    }
    return updated;
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    const old = await this.getById(id);
    assertOwnerOrAdmin(actor, old.userId, 'Equipo');
    await equipoRepository.delete(id);
    await mediaService.scheduleImageCleanup(old.logo, old.logoPublicId);
  },
};
