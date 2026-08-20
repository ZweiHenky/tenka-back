import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { ligaRepository } from './repository';
import { mediaService } from '../media/service';
import { prisma } from '../../config/database';
import type { LigaEntity, LigaCanchaEntity, LigaArbitroEntity, ProgramacionRecienteLigaDto, LigaReglaItem, PublicLeagueListDto, UserLeagueListDto } from './entity';
import type { LigaCanchaWrite, LigaFilterParams, LigaWriteData } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { runInTransaction } from '../../utils/transaction';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import { signalBackgroundJob } from '../../workers/jobSignals';

const DUPLICATE_NAME_MESSAGE = 'Ya existe una liga con ese nombre';
const DUPLICATE_COURT_MESSAGE = 'Ya existe una cancha con ese nombre en esta liga';
const MINIMUM_COURTS_MESSAGE = 'Una liga con múltiples canchas debe conservar al menos 2 canchas activas';

function normalizeName(nombre: string): string {
  return nombre.trim().toLowerCase();
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function isCourtUniqueConstraintError(error: unknown): boolean {
  if (!isUniqueConstraintError(error) || typeof error !== 'object' || error === null || !('meta' in error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target)
    ? target.includes('nombreNormalizado')
    : typeof target === 'string' && target.includes('nombreNormalizado');
}

function validateCanchas(multiplesCanchas: boolean, canchas: { nombre: string }[]) {
  if (multiplesCanchas && canchas.length < 2) {
    throw new ValidationError('Una liga con múltiples canchas debe tener al menos 2 canchas');
  }

  const nombres = canchas.map((cancha) => cancha.nombre.trim().toLowerCase());
  if (new Set(nombres).size !== nombres.length) {
    throw new ValidationError('Los nombres de las canchas no pueden repetirse');
  }
}

function reconcileCanchas(
  current: Array<{ id: string; nombre: string; nombreNormalizado: string; activa: boolean }>,
  incoming: Array<{ id?: string; nombre?: string; activa?: boolean }>,
  multiplesCanchas: boolean,
): LigaCanchaWrite[] {
  const currentById = new Map(current.map((cancha) => [cancha.id, cancha]));
  const incomingIds = incoming.flatMap((cancha) => cancha.id ? [cancha.id] : []);
  if (new Set(incomingIds).size !== incomingIds.length) {
    throw new ValidationError('Una cancha no puede aparecer más de una vez');
  }
  for (const id of incomingIds) {
    if (!currentById.has(id)) throw new ValidationError('La cancha indicada no pertenece a esta liga');
  }

  const requestedById = new Map(incoming.flatMap((cancha) => cancha.id ? [[cancha.id, cancha] as const] : []));
  const reconciled: LigaCanchaWrite[] = current.map((cancha) => {
    const requested = requestedById.get(cancha.id);
    const nombre = requested?.nombre?.trim() ?? cancha.nombre;
    return {
      id: cancha.id,
      nombre,
      nombreNormalizado: normalizeName(nombre),
      nombreNormalizadoAnterior: cancha.nombreNormalizado,
      activa: multiplesCanchas && requested !== undefined ? (requested.activa ?? cancha.activa) : false,
    };
  });
  for (const cancha of incoming) {
    if (cancha.id) continue;
    const nombre = cancha.nombre!.trim();
    reconciled.push({
      nombre,
      nombreNormalizado: normalizeName(nombre),
      activa: multiplesCanchas && (cancha.activa ?? true),
    });
  }

  const normalizedNames = reconciled.map((cancha) => cancha.nombreNormalizado);
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    throw new ConflictError(DUPLICATE_COURT_MESSAGE);
  }
  if (multiplesCanchas && reconciled.filter((cancha) => cancha.activa).length < 2) {
    throw new ValidationError(MINIMUM_COURTS_MESSAGE);
  }
  return reconciled;
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
  async list(): Promise<PublicLeagueListDto[]> {
    return ligaRepository.findAll();
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<LigaEntity> {
    const liga = await ligaRepository.findVisibleById(id, actor);
    if (!liga) throw new NotFoundError('Liga');
    return liga;
  },

  async listByUser(userId: string, actor?: AuthenticatedUser): Promise<Array<PublicLeagueListDto | UserLeagueListDto>> {
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
    logoAssetId?: string | null;
    coverAssetId?: string | null;
    multiplesCanchas?: boolean;
    canchas?: { nombre: string }[];
    usaArbitros?: boolean;
    arbitros?: { nombre: string }[];
    reglas?: LigaReglaItem[];
    ubicacionId: string;
    userId: string;
  }): Promise<LigaEntity> {
    const { canchas, arbitros, logoAssetId, coverAssetId, ...ligaData } = data;
    const location = await prisma.ubicacion.findUnique({ where: { id: data.ubicacionId }, select: { timeZone: true } });
    if (!location) throw new NotFoundError('Ubicación');
    const authoritativeLigaData = { ...ligaData, timeZone: location.timeZone };
    validateCanchas(data.multiplesCanchas ?? false, canchas ?? []);
    validateArbitros(data.usaArbitros ?? false, arbitros ?? []);
    const nombre = data.nombre.trim();
    const nombreNormalizado = normalizeName(nombre);
    if (await ligaRepository.findByNormalizedName(nombreNormalizado)) {
      throw new ConflictError(DUPLICATE_NAME_MESSAGE);
    }
    try {
      const courtWrites = canchas?.map((cancha) => ({
        nombre: cancha.nombre.trim(),
        nombreNormalizado: normalizeName(cancha.nombre),
        activa: data.multiplesCanchas === true,
      }));
      if (logoAssetId === undefined && coverAssetId === undefined) {
        return await ligaRepository.create({ ...authoritativeLigaData, nombre, nombreNormalizado }, courtWrites, arbitros);
      }
      return await runInTransaction(async (tx) => {
        const logo = logoAssetId !== undefined ? await mediaService.prepareAttachment(tx, logoAssetId, data.userId, 'LEAGUE_LOGO') : undefined;
        const cover = coverAssetId !== undefined ? await mediaService.prepareAttachment(tx, coverAssetId, data.userId, 'LEAGUE_COVER') : undefined;
        return ligaRepository.create({
          ...authoritativeLigaData,
          nombre,
          nombreNormalizado,
          ...(logo && { logo: logo.url, logoPublicId: logo.publicId }),
          ...(cover && { cancha: cover.url, canchaPublicId: cover.publicId }),
        }, courtWrites, arbitros, tx);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
  },

  async update(id: string, data: {
    nombre?: string;
    descripcion?: string;
    logoAssetId?: string | null;
    coverAssetId?: string | null;
    multiplesCanchas?: boolean;
    canchas?: Array<{ id?: string; nombre?: string; activa?: boolean }>;
    usaArbitros?: boolean;
    arbitros?: { nombre: string }[];
    reglas?: LigaReglaItem[];
    ubicacionId?: string;
  }, actor: AuthenticatedUser): Promise<LigaEntity> {
    const old = await ligaRepository.findUpdateContext(id, actor);
    if (!old) throw new NotFoundError('Liga');
    const { canchas, arbitros, logoAssetId, coverAssetId, ...rawLigaData } = data;
    const ligaData: LigaWriteData = rawLigaData;
    if (data.ubicacionId) {
      const location = await prisma.ubicacion.findUnique({ where: { id: data.ubicacionId }, select: { timeZone: true } });
      if (!location) throw new NotFoundError('Ubicación');
      ligaData.timeZone = location.timeZone;
    }
    const multiplesCanchas = data.multiplesCanchas ?? old.multiplesCanchas;
    let courtWrites: LigaCanchaWrite[] | undefined;
    if (canchas !== undefined) {
      courtWrites = reconcileCanchas(old.canchas, canchas, multiplesCanchas);
    } else if (!multiplesCanchas) {
      courtWrites = reconcileCanchas(old.canchas, [], false);
    } else if (old.canchas.filter((cancha) => cancha.activa).length < 2) {
      throw new ValidationError(MINIMUM_COURTS_MESSAGE);
    }
    const nextArbitros = arbitros ?? old.arbitros;
    validateArbitros(data.usaArbitros ?? old.usaArbitros, nextArbitros);
    if (data.nombre !== undefined) {
      const nombre = data.nombre.trim();
      const nombreNormalizado = normalizeName(nombre);
      ligaData.nombre = nombre;
      ligaData.nombreNormalizado = nombreNormalizado;
      if (await ligaRepository.findByNormalizedName(nombreNormalizado, id)) {
        throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      }
    }
    let updated: LigaEntity;
    try {
      const disablingMultipleCourts = old.multiplesCanchas && data.multiplesCanchas === false;
      // Turning multiple courts off drops every court and nulls each division's canchaUnicaId,
      // so it has to be serialized against jornada generation like any other venue change.
      const touchesCourts = disablingMultipleCourts || (courtWrites !== undefined && courtWrites.length > 0);
      if (logoAssetId === undefined && coverAssetId === undefined) {
        updated = touchesCourts
          ? await runInTransaction(async (tx) => {
              await acquireLeagueScheduleLock(tx, id);
              return ligaRepository.update(id, ligaData, courtWrites, arbitros, disablingMultipleCourts, tx);
            })
          : await ligaRepository.update(id, ligaData, courtWrites, arbitros);
      } else updated = await runInTransaction(async (tx) => {
        // Advisory lock first, row lock second — keeps a single ordering across all writers.
        if (touchesCourts) await acquireLeagueScheduleLock(tx, id);
        await mediaService.lockAttachmentTarget(tx, 'liga', id);
        const current = await tx.liga.findUniqueOrThrow({
          where: { id },
          select: { logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
        });
        const logo = logoAssetId !== undefined ? await mediaService.prepareAttachment(tx, logoAssetId, actor.id, 'LEAGUE_LOGO', current.logo, current.logoPublicId) : undefined;
        const cover = coverAssetId !== undefined ? await mediaService.prepareAttachment(tx, coverAssetId, actor.id, 'LEAGUE_COVER', current.cancha, current.canchaPublicId) : undefined;
        const writeData = {
          ...ligaData,
          ...(logo && { logo: logo.url, logoPublicId: logo.publicId }),
          ...(cover && { cancha: cover.url, canchaPublicId: cover.publicId }),
        };
        return ligaRepository.update(id, writeData, courtWrites, arbitros, disablingMultipleCourts, tx);
      });
      signalBackgroundJob('media-deletion');
    } catch (error) {
      if (isCourtUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_COURT_MESSAGE);
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      throw error;
    }
    return updated;
  },

  async delete(id: string, actor: AuthenticatedUser, confirmName?: string): Promise<void> {
    const old = await ligaRepository.findDeleteContext(id, actor);
    if (!old) throw new NotFoundError('Liga');
    if (confirmName !== undefined && normalizeName(old.nombre) !== normalizeName(confirmName)) {
      throw new ValidationError('El nombre no coincide. Escribe el nombre de la liga para confirmar.');
    }
    if (!old.logo && !old.cancha) {
      await ligaRepository.delete(id);
      return;
    }
    await runInTransaction(async (tx) => {
      await mediaService.scheduleImageCleanup(old.logo, old.logoPublicId, tx);
      await mediaService.scheduleImageCleanup(old.cancha, old.canchaPublicId, tx);
      await ligaRepository.delete(id, 'liga' in tx ? tx : undefined);
    });
    signalBackgroundJob('media-deletion');
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
    const nombre = data.nombre.trim();
    const nombreNormalizado = normalizeName(nombre);
    const existing = await prisma.ligaCancha.findFirst({ where: { ligaId, nombreNormalizado } });
    if (existing) throw new ConflictError(DUPLICATE_COURT_MESSAGE);
    try {
      return await prisma.ligaCancha.create({ data: { nombre, nombreNormalizado, ligaId } });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_COURT_MESSAGE);
      throw error;
    }
  },

  async updateCancha(ligaId: string, canchaId: string, data: { nombre?: string; activa?: boolean }, actor: AuthenticatedUser): Promise<LigaCanchaEntity> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    try {
      // Deactivating a court changes what generateNext considers a valid venue, so the reads
      // that gate it must happen under the league schedule lock.
      return await runInTransaction(async (tx) => {
        await acquireLeagueScheduleLock(tx, ligaId);
        const cancha = await tx.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
        if (!cancha) throw new NotFoundError('Cancha');
        if (!liga.multiplesCanchas && data.activa === true) {
          throw new ValidationError('Una liga sin múltiples canchas no puede tener canchas activas');
        }
        if (liga.multiplesCanchas && cancha.activa && data.activa === false) {
          const remainingActive = await tx.ligaCancha.count({
            where: { ligaId, activa: true, id: { not: canchaId } },
          });
          if (remainingActive < 2) throw new ValidationError(MINIMUM_COURTS_MESSAGE);
        }
        const updateData: { nombre?: string; nombreNormalizado?: string; activa?: boolean } = {};
        if (data.activa !== undefined) updateData.activa = data.activa;
        if (data.nombre !== undefined) {
          const nombre = data.nombre.trim();
          const nombreNormalizado = normalizeName(nombre);
          const existing = await tx.ligaCancha.findFirst({
            where: { ligaId, nombreNormalizado, id: { not: canchaId } },
          });
          if (existing) throw new ConflictError(DUPLICATE_COURT_MESSAGE);
          updateData.nombre = nombre;
          updateData.nombreNormalizado = nombreNormalizado;
        }
        return tx.ligaCancha.update({ where: { id: canchaId }, data: updateData });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(DUPLICATE_COURT_MESSAGE);
      throw error;
    }
  },

  async deleteCancha(ligaId: string, canchaId: string, actor: AuthenticatedUser): Promise<void> {
    const liga = await ligaRepository.findManagementContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');
    // Everything below runs under the league schedule lock and is re-read inside it: a
    // concurrent generateNext could otherwise commit matches on this court between the count
    // and the delete, and onDelete: SetNull would strip their canchaId — putting them outside
    // the partidos_cancha_no_overlap constraint and blocking generation for the whole league.
    await runInTransaction(async (tx) => {
      await acquireLeagueScheduleLock(tx, ligaId);
      const cancha = await tx.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
      if (!cancha) throw new NotFoundError('Cancha');
      if (liga.multiplesCanchas && cancha.activa) {
        const remainingActive = await tx.ligaCancha.count({
          where: { ligaId, activa: true, id: { not: canchaId } },
        });
        if (remainingActive < 2) throw new ValidationError(MINIMUM_COURTS_MESSAGE);
      }
      const [matchCount, fixedDivisionCount, scheduleCount] = await Promise.all([
        tx.partido.count({ where: { canchaId } }),
        tx.division.count({ where: { canchaUnicaId: canchaId } }),
        // A court some division schedules on must be deactivated, never hard-deleted.
        tx.divisionCanchaHorario.count({ where: { canchaId } }),
      ]);
      if (matchCount > 0 || fixedDivisionCount > 0 || scheduleCount > 0) {
        await tx.ligaCancha.update({ where: { id: canchaId }, data: { activa: false } });
      } else {
        await tx.ligaCancha.delete({ where: { id: canchaId } });
      }
    });
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
