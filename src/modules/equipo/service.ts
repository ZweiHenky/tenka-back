import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { equipoRepository } from './repository';
import { mediaService } from '../media/service';
import type { EquipoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { prisma } from '../../config/database';
import { runInTransaction } from '../../utils/transaction';
import type { Pagination } from '../../utils/pagination';
import { signalBackgroundJob } from '../../workers/jobSignals';

const DUPLICATE_NAME_MESSAGE = 'Ya tienes un equipo con ese nombre';

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export const equipoService = {
  async list(): Promise<EquipoEntity[]> {
    return equipoRepository.findAll();
  },

  async listPaginated(pagination: Pagination) {
    return equipoRepository.findAllPaginated(pagination);
  },

  async listByUser(userId: string): Promise<EquipoEntity[]> {
    return equipoRepository.findByUser(userId);
  },

  async getById(id: string): Promise<EquipoEntity> {
    const t = await equipoRepository.findById(id);
    if (!t) throw new NotFoundError('Equipo');
    return t;
  },

  async create(data: { nombre: string; logoAssetId?: string | null; userId: string }): Promise<EquipoEntity> {
    const nombre = data.nombre.trim();
    const nombreNormalizado = nombre.toLowerCase();
    if (await equipoRepository.findByNormalizedName(data.userId, nombreNormalizado)) {
      throw new ConflictError(DUPLICATE_NAME_MESSAGE);
    }
    try {
      if (data.logoAssetId === undefined) return await equipoRepository.create({ nombre, nombreNormalizado, userId: data.userId });
      return await runInTransaction(async (tx) => {
        const media = data.logoAssetId !== undefined ? await mediaService.prepareAttachment(tx, data.logoAssetId, data.userId, 'TEAM_LOGO') : undefined;
        return equipoRepository.create({
            nombre,
            nombreNormalizado,
            userId: data.userId,
            ...(media && { logo: media.url, logoPublicId: media.publicId }),
        }, tx);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
  },

  async update(id: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<EquipoEntity> {
    const old = await this.getById(id);
    assertOwnerOrAdmin(actor, old.userId, 'Equipo');
    const { logoAssetId, ...updateData } = data as { logoAssetId?: string | null; [key: string]: unknown };
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
      if (logoAssetId === undefined) return await equipoRepository.update(id, updateData);
      updated = await runInTransaction(async (tx) => {
        await mediaService.lockAttachmentTarget(tx, 'equipo', id);
        const current = await tx.equipo.findUniqueOrThrow({ where: { id }, select: { logo: true, logoPublicId: true } });
        const media = logoAssetId !== undefined ? await mediaService.prepareAttachment(tx, logoAssetId, actor.id, 'TEAM_LOGO', current.logo, current.logoPublicId) : undefined;
        return equipoRepository.update(id, { ...updateData, ...(media && { logo: media.url, logoPublicId: media.publicId }) }, tx);
      });
      signalBackgroundJob('media-deletion');
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
    return updated;
  },

  async delete(id: string, actor: AuthenticatedUser, confirmName?: string): Promise<void> {
    const old = await this.getById(id);
    assertOwnerOrAdmin(actor, old.userId, 'Equipo');
    if (confirmName !== undefined && old.nombre.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
      throw new ValidationError('El nombre no coincide. Escribe el nombre del equipo para confirmar.');
    }
    if (!old.logo) {
      await equipoRepository.delete(id);
      return;
    }
    await runInTransaction(async (tx) => {
      await mediaService.scheduleImageCleanup(old.logo, old.logoPublicId, tx);
      await equipoRepository.delete(id, tx);
    });
    signalBackgroundJob('media-deletion');
  },
};
