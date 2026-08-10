import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { divisionRepository } from './repository';
import type { DivisionEntity } from './entity';
import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../types/auth';
import { isAdmin } from '../../utils/authorization';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';

async function assertLigaOwner(ligaId: string, actor: AuthenticatedUser): Promise<void> {
  const liga = await prisma.liga.findFirst({
    where: isAdmin(actor) ? { id: ligaId } : { id: ligaId, userId: actor.id },
    select: { id: true },
  });
  if (!liga) throw new NotFoundError('Liga');
}

async function assertDivisionOwner(id: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
    select: { id: true },
  });
  if (!division) throw new NotFoundError('Division');
}

async function getDivisionUpdateContext(id: string, actor: AuthenticatedUser) {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
    select: { id: true, ligaId: true, canchaUnicaId: true, registrarParticipaciones: true, usarPenalesEnEmpates: true },
  });
  if (!division) throw new NotFoundError('Division');
  return division;
}

export const divisionService = {
  async list(actor?: AuthenticatedUser): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ where: visibleDivisionWhere(actor), orderBy: { createdAt: 'desc' } });
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<DivisionEntity> {
    const division = await prisma.division.findFirst({
      where: { id, ...visibleDivisionWhere(actor) },
      include: { liga: { select: { id: true, nombre: true, logo: true } }, estadoLiga: { select: { id: true, nombre: true } } },
    }) as DivisionEntity | null;
    if (!division) throw new NotFoundError('Division');
    return division;
  },

  async listByLiga(ligaId: string, actor?: AuthenticatedUser): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ where: { ligaId, ...visibleDivisionWhere(actor) }, orderBy: { createdAt: 'desc' } });
  },

  async create(data: {
    nombre: string;
    maxEquipos: number;
    arbitraje?: number;
    registrarParticipaciones?: boolean;
    usarPenalesEnEmpates?: boolean;
    diasPartido?: string;
    horarioPartido?: string;
    duracionPartido?: number;
    descanso?: number;
    fechaInicio?: Date;
    fechaFin?: Date;
    estadoLigaId?: string;
    ligaId: string;
    categoriaId: string;
    tipoId: string;
    tipoCompetenciaId: string;
  }, actor: AuthenticatedUser): Promise<DivisionEntity> {
    await assertLigaOwner(data.ligaId, actor);
    const estadoLigaId = data.estadoLigaId ?? (await prisma.estadoLiga.findFirstOrThrow({
      where: { nombre: 'Borrador' },
      select: { id: true },
    })).id;
    return divisionRepository.create({ ...data, estadoLigaId });
  },

  async update(id: string, data: Partial<DivisionEntity>, actor: AuthenticatedUser): Promise<DivisionEntity> {
    const division = await getDivisionUpdateContext(id, actor);
    if (data.ligaId) await assertLigaOwner(data.ligaId, actor);
    const ligaId = data.ligaId ?? division.ligaId;
    let updateData = data;

    if (data.ligaId && data.canchaUnicaId === undefined && division.canchaUnicaId) {
      updateData = { ...data, canchaUnicaId: null };
    }

    if (data.canchaUnicaId && data.registrarParticipaciones === undefined) {
      const cancha = await prisma.ligaCancha.findFirst({
        where: { id: data.canchaUnicaId },
        select: { ligaId: true, activa: true, liga: { select: { multiplesCanchas: true } } },
      });
      if (!cancha || cancha.ligaId !== ligaId) {
        throw new ValidationError('La cancha indicada no pertenece a esta liga');
      }
      if (!cancha.liga.multiplesCanchas) {
        throw new ValidationError('La liga no tiene múltiples canchas habilitadas');
      }
      if (!cancha.activa) throw new ValidationError('La cancha seleccionada no está activa');
    }

    if (data.registrarParticipaciones !== undefined || data.usarPenalesEnEmpates !== undefined) {
      return prisma.$transaction(async (tx) => {
        const leagueIds = [...new Set([division.ligaId, ligaId])].sort();
        for (const lockedLeagueId of leagueIds) await acquireLeagueScheduleLock(tx, lockedLeagueId);

        const lockedDivision = await tx.division.findFirst({
          where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
          select: { id: true, ligaId: true, canchaUnicaId: true, registrarParticipaciones: true, usarPenalesEnEmpates: true },
        });
        if (!lockedDivision) throw new NotFoundError('Division');
        if (lockedDivision.ligaId !== division.ligaId) {
          throw new ConflictError('La división cambió de liga durante la actualización; vuelve a intentarlo');
        }

        if (data.ligaId) {
          const targetLeague = await tx.liga.findFirst({
            where: isAdmin(actor) ? { id: data.ligaId } : { id: data.ligaId, userId: actor.id },
            select: { id: true },
          });
          if (!targetLeague) throw new NotFoundError('Liga');
        }

        if (data.canchaUnicaId) {
          const cancha = await tx.ligaCancha.findFirst({
            where: { id: data.canchaUnicaId },
            select: { ligaId: true, activa: true, liga: { select: { multiplesCanchas: true } } },
          });
          if (!cancha || cancha.ligaId !== ligaId) {
            throw new ValidationError('La cancha indicada no pertenece a esta liga');
          }
          if (!cancha.liga.multiplesCanchas) {
            throw new ValidationError('La liga no tiene múltiples canchas habilitadas');
          }
          if (!cancha.activa) throw new ValidationError('La cancha seleccionada no está activa');
        }

        if (data.usarPenalesEnEmpates !== undefined
          && data.usarPenalesEnEmpates !== lockedDivision.usarPenalesEnEmpates) {
          const finalizedMatches = await tx.partido.count({
            where: {
              estado: 'FINALIZADO',
              OR: [
                { jornada: { divisionId: id } },
                { rondaPlayoff: { divisionId: id } },
              ],
            },
          });
          if (finalizedMatches > 0) {
            throw new ValidationError('No puedes cambiar la regla de penales porque la división ya tiene partidos finalizados');
          }
        }

        let lockedUpdateData = data;
        if (data.ligaId && data.canchaUnicaId === undefined && lockedDivision.canchaUnicaId) {
          lockedUpdateData = { ...data, canchaUnicaId: null };
        }
        return divisionRepository.update(id, lockedUpdateData, tx);
      }, { isolationLevel: 'ReadCommitted' });
    }

    return divisionRepository.update(id, updateData);
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(id, actor);

    await prisma.$transaction(async (tx) => {
      const subscriptions = await tx.divisionNotificationSubscription.findMany({
        where: { divisionId: id },
        select: { oneSignalId: true },
      });

      if (subscriptions.length) {
        const tag = `division_${id}`;
        for (const { oneSignalId } of subscriptions) {
          await tx.oneSignalTagCleanupJob.upsert({
            where: { oneSignalId_tag: { oneSignalId, tag } },
            create: { oneSignalId, tag, desired: false },
            update: { desired: false, status: 'PENDING', attempts: 0, lastError: null, deadAt: null, leaseUntil: null, lockedBy: null, nextTryAt: new Date() },
          });
        }
      }

      await divisionRepository.delete(id, tx);
    });
  },

  async resetDivision(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);

    await prisma.$transaction(async (tx) => {
      await tx.jornada.deleteMany({ where: { divisionId } });
      await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
      await tx.tablaPosicion.deleteMany({ where: { divisionId } });
    });
  },
};
