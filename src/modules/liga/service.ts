import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { ligaRepository } from './repository';
import { mediaService } from '../media/service';
import { prisma } from '../../config/database';
import type { LigaEntity, LigaCanchaEntity, LigaArbitroEntity, ProgramacionRecienteLigaDto } from './entity';
import type { LigaFilterParams } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';

const DUPLICATE_NAME_MESSAGE = 'Ya existe una liga con ese nombre';

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function validateCanchas(multiplesCanchas: boolean, canchas: { nombre: string }[]) {
  if (multiplesCanchas && canchas.length < 2) {
    throw new ValidationError('Una liga con múltiples canchas debe tener al menos 2 canchas');
  }

  const nombres = canchas.map((cancha) => cancha.nombre.trim().toLocaleLowerCase());
  if (new Set(nombres).size !== nombres.length) {
    throw new ValidationError('Los nombres de las canchas no pueden repetirse');
  }
}

function validateArbitros(usaArbitros: boolean, arbitros: { nombre: string }[]) {
  if (usaArbitros && arbitros.length < 2) {
    throw new ValidationError('Debes agregar al menos 2 árbitros');
  }

  const nombres = arbitros.map((a) => a.nombre.trim().toLocaleLowerCase());
  if (new Set(nombres).size !== nombres.length) {
    throw new ValidationError('Los nombres de los árbitros no pueden repetirse');
  }
}

export const ligaService = {
  async list(): Promise<LigaEntity[]> {
    return ligaRepository.findAll();
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<LigaEntity> {
    const liga = await ligaRepository.findVisibleById(id, actor);
    if (!liga) throw new NotFoundError('Liga');
    return liga;
  },

  async listByUser(userId: string, actor?: AuthenticatedUser): Promise<LigaEntity[]> {
    if (actor?.rol === 'ADMINISTRADOR' || actor?.id === userId) {
      return ligaRepository.findByUser(userId);
    }
    return ligaRepository.findPublicByUser(userId);
  },

  async listPaginated(params: LigaFilterParams) {
    return ligaRepository.findAllPaginated(params);
  },

  async create(data: {
    nombre: string;
    descripcion: string;
    logo?: string;
    logoPublicId?: string;
    cancha?: string;
    canchaPublicId?: string;
    multiplesCanchas?: boolean;
    canchas?: { nombre: string }[];
    usaArbitros?: boolean;
    arbitros?: { nombre: string }[];
    ubicacionId: string;
    userId: string;
  }): Promise<LigaEntity> {
    const { canchas, arbitros, ...ligaData } = data;
    validateCanchas(data.multiplesCanchas ?? false, canchas ?? []);
    validateArbitros(data.usaArbitros ?? false, arbitros ?? []);
    const nombre = data.nombre.trim();
    const nombreNormalizado = nombre.toLowerCase();
    if (await ligaRepository.findByNormalizedName(nombreNormalizado)) {
      throw new ConflictError(DUPLICATE_NAME_MESSAGE);
    }
    try {
      return await ligaRepository.create({ ...ligaData, nombre, nombreNormalizado }, canchas, arbitros);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
  },

  async update(id: string, data: {
    nombre?: string;
    descripcion?: string;
    logo?: string;
    logoPublicId?: string;
    cancha?: string;
    canchaPublicId?: string;
    multiplesCanchas?: boolean;
    canchas?: { nombre: string }[];
    usaArbitros?: boolean;
    arbitros?: { nombre: string }[];
    ubicacionId?: string;
  }, actor: AuthenticatedUser): Promise<LigaEntity> {
    const old = await ligaRepository.findUpdateContext(id, actor);
    if (!old) throw new NotFoundError('Liga');
    const { canchas, arbitros, ...ligaData } = data;
    const nextCanchas = canchas ?? old.canchas;
    validateCanchas(data.multiplesCanchas ?? old.multiplesCanchas, nextCanchas);
    const nextArbitros = arbitros ?? old.arbitros;
    validateArbitros(data.usaArbitros ?? old.usaArbitros, nextArbitros);
    if (data.nombre !== undefined) {
      const nombre = data.nombre.trim();
      const nombreNormalizado = nombre.toLowerCase();
      ligaData.nombre = nombre;
      (ligaData as Record<string, unknown>).nombreNormalizado = nombreNormalizado;
      if (await ligaRepository.findByNormalizedName(nombreNormalizado, id)) {
        throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      }
    }
    let updated: LigaEntity;
    try {
      updated = await ligaRepository.update(id, ligaData, canchas, arbitros);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
    if (data.logo !== undefined && data.logo !== old.logo) {
      await mediaService.scheduleImageCleanup(old.logo, old.logoPublicId);
    }
    if (data.cancha !== undefined && data.cancha !== old.cancha) {
      await mediaService.scheduleImageCleanup(old.cancha, old.canchaPublicId);
    }
    return updated;
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    const old = await ligaRepository.findDeleteContext(id, actor);
    if (!old) throw new NotFoundError('Liga');
    await ligaRepository.delete(id);
    await mediaService.scheduleImageCleanup(old.logo, old.logoPublicId);
    await mediaService.scheduleImageCleanup(old.cancha, old.canchaPublicId);
  },

  async getCanchas(ligaId: string, actor: AuthenticatedUser): Promise<LigaCanchaEntity[]> {
    const canchas = await ligaRepository.findManageableCanchas(ligaId, actor);
    if (!canchas) throw new NotFoundError('Liga');
    return canchas;
  },

  async createCancha(ligaId: string, data: { nombre: string }, actor: AuthenticatedUser): Promise<LigaCanchaEntity> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    if (!liga.multiplesCanchas) {
      throw new ValidationError('La liga no tiene múltiples canchas habilitadas');
    }
    const existing = await prisma.ligaCancha.findUnique({
      where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
    });
    if (existing) throw new ConflictError('Ya existe una cancha con ese nombre en esta liga');
    return prisma.ligaCancha.create({
      data: { ...data, ligaId },
    });
  },

  async updateCancha(ligaId: string, canchaId: string, data: { nombre?: string; activa?: boolean }, actor: AuthenticatedUser): Promise<LigaCanchaEntity> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    const cancha = await prisma.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
    if (!cancha) throw new NotFoundError('Cancha');
    if (data.nombre && data.nombre !== cancha.nombre) {
      const existing = await prisma.ligaCancha.findUnique({
        where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
      });
      if (existing) throw new ConflictError('Ya existe una cancha con ese nombre en esta liga');
    }
    return prisma.ligaCancha.update({ where: { id: canchaId }, data });
  },

  async deleteCancha(ligaId: string, canchaId: string, actor: AuthenticatedUser): Promise<void> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    const cancha = await prisma.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
    if (!cancha) throw new NotFoundError('Cancha');
    const matchCount = await prisma.partido.count({ where: { canchaId } });
    if (matchCount > 0) {
      await prisma.ligaCancha.update({ where: { id: canchaId }, data: { activa: false } });
    } else {
      await prisma.ligaCancha.delete({ where: { id: canchaId } });
    }
  },

  async getArbitros(ligaId: string, actor: AuthenticatedUser): Promise<LigaArbitroEntity[]> {
    const arbitros = await ligaRepository.findManageableArbitros(ligaId, actor);
    if (!arbitros) throw new NotFoundError('Liga');
    return arbitros;
  },

  async getRecentSchedule(ligaId: string, actor: AuthenticatedUser): Promise<ProgramacionRecienteLigaDto> {
    const schedule = await ligaRepository.findRecentSchedule(ligaId, actor);
    if (!schedule) throw new NotFoundError('Liga');
    return schedule;
  },

  async createArbitro(ligaId: string, data: { nombre: string }, actor: AuthenticatedUser): Promise<LigaArbitroEntity> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    if (!liga.usaArbitros) {
      throw new ValidationError('La liga no tiene árbitros habilitados');
    }
    const existing = await prisma.ligaArbitro.findUnique({
      where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
    });
    if (existing) throw new ConflictError('Ya existe un árbitro con ese nombre en esta liga');
    return prisma.ligaArbitro.create({
      data: { ...data, ligaId },
    });
  },

  async updateArbitro(ligaId: string, arbitroId: string, data: { nombre?: string; activo?: boolean }, actor: AuthenticatedUser): Promise<LigaArbitroEntity> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    const arbitro = await prisma.ligaArbitro.findFirst({ where: { id: arbitroId, ligaId } });
    if (!arbitro) throw new NotFoundError('Árbitro');
    if (liga.usaArbitros && arbitro.activo && data.activo === false) {
      const remainingActive = await prisma.ligaArbitro.count({
        where: { ligaId, activo: true, id: { not: arbitroId } },
      });
      if (remainingActive < 2) {
        throw new ValidationError('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
      }
    }
    if (data.nombre && data.nombre !== arbitro.nombre) {
      const existing = await prisma.ligaArbitro.findUnique({
        where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
      });
      if (existing) throw new ConflictError('Ya existe un árbitro con ese nombre en esta liga');
    }
    return prisma.ligaArbitro.update({ where: { id: arbitroId }, data });
  },

  async deleteArbitro(ligaId: string, arbitroId: string, actor: AuthenticatedUser): Promise<void> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    const arbitro = await prisma.ligaArbitro.findFirst({ where: { id: arbitroId, ligaId } });
    if (!arbitro) throw new NotFoundError('Árbitro');
    if (liga.usaArbitros && arbitro.activo) {
      const remainingActive = await prisma.ligaArbitro.count({
        where: { ligaId, activo: true, id: { not: arbitroId } },
      });
      if (remainingActive < 2) {
        throw new ValidationError('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
      }
    }
    const matchCount = await prisma.partidoArbitro.count({ where: { arbitroId } });
    if (matchCount > 0) {
      await prisma.ligaArbitro.update({ where: { id: arbitroId }, data: { activo: false } });
    } else {
      await prisma.ligaArbitro.delete({ where: { id: arbitroId } });
    }
  },
};
