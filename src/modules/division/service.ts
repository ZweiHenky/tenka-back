import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { assertDivisionWritable, isDivisionWritable } from '../../utils/divisionState';
import { campeonRepository } from '../campeon/repository';
import { divisionRepository } from './repository';
import type { DivisionEntity } from './entity';
import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../types/auth';
import { isAdmin } from '../../utils/authorization';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import { summarizeDivisionSchedule, type CourtScheduleRow } from '../../utils/divisionSchedule';
import type { Prisma } from '../../generated/prisma/client';
import type { Pagination } from '../../utils/pagination';
import { signalBackgroundJob } from '../../workers/jobSignals';

async function assertLigaOwner(ligaId: string, actor: AuthenticatedUser): Promise<void> {
  const liga = await prisma.liga.findFirst({
    where: isAdmin(actor) ? { id: ligaId } : { id: ligaId, userId: actor.id },
    select: { id: true },
  });
  if (!liga) throw new NotFoundError('Liga');
}

async function assertDivisionOwner(id: string, actor: AuthenticatedUser): Promise<{ estadoLiga: { codigo: string } }> {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
    select: { id: true, estadoLiga: { select: { codigo: true } } },
  });
  if (!division) throw new NotFoundError('Division');
  return division;
}

/**
 * Validates the courts a per-court schedule refers to. They must all belong to the league, be
 * active, and the league must actually run multiple courts.
 */
async function assertCourtsUsable(
  tx: Prisma.TransactionClient,
  ligaId: string,
  rows: CourtScheduleRow[],
): Promise<void> {
  const liga = await tx.liga.findUnique({ where: { id: ligaId }, select: { multiplesCanchas: true } });
  if (!liga) throw new NotFoundError('Liga');
  if (!liga.multiplesCanchas) {
    throw new ValidationError('La liga no tiene múltiples canchas habilitadas');
  }
  const canchas = await tx.ligaCancha.findMany({
    where: { id: { in: rows.map((row) => row.canchaId) }, ligaId },
    select: { id: true, activa: true },
  });
  const byId = new Map(canchas.map((cancha) => [cancha.id, cancha]));
  for (const row of rows) {
    const cancha = byId.get(row.canchaId);
    if (!cancha) throw new ValidationError('La cancha indicada no pertenece a esta liga');
    if (!cancha.activa) throw new ValidationError('La cancha seleccionada no está activa');
  }
}

/**
 * Replaces the division's per-court schedule with `rows` and returns the denormalized summary
 * to write onto the division. An empty array clears the rows and reverts to the scalars.
 */
async function replaceCourtSchedules(
  tx: Prisma.TransactionClient,
  divisionId: string,
  ligaId: string,
  rows: CourtScheduleRow[],
): Promise<{ diasPartido: string; horarioPartido: string } | null> {
  if (rows.length > 0) await assertCourtsUsable(tx, ligaId, rows);
  await tx.divisionCanchaHorario.deleteMany({
    where: { divisionId, canchaId: { notIn: rows.map((row) => row.canchaId) } },
  });
  for (const row of rows) {
    await tx.divisionCanchaHorario.upsert({
      where: { divisionId_canchaId: { divisionId, canchaId: row.canchaId } },
      create: { divisionId, canchaId: row.canchaId, diasPartido: row.diasPartido, horarioPartido: row.horarioPartido },
      update: { diasPartido: row.diasPartido, horarioPartido: row.horarioPartido },
    });
  }
  return rows.length > 0 ? summarizeDivisionSchedule(rows) : null;
}

async function getDivisionUpdateContext(id: string, actor: AuthenticatedUser) {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
    select: { id: true, ligaId: true, registrarParticipaciones: true, usarPenalesEnEmpates: true },
  });
  if (!division) throw new NotFoundError('Division');
  return division;
}

export const divisionService = {
  async list(pagination: Pagination, actor?: AuthenticatedUser) {
    const where = visibleDivisionWhere(actor);
    const [rows, total] = await Promise.all([
      prisma.division.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
      prisma.division.count({ where }),
    ]);
    return { rows, total };
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<DivisionEntity> {
    const division = await prisma.division.findFirst({
      where: { id, ...visibleDivisionWhere(actor) },
      include: {
        liga: { select: { id: true, nombre: true, logo: true } },
        estadoLiga: { select: { id: true, nombre: true } },
        canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } },
      },
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
    horariosPorCancha?: CourtScheduleRow[];
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
      where: { codigo: 'BORRADOR' },
      select: { id: true },
    })).id;
    const { horariosPorCancha, ...divisionData } = data;
    if (!horariosPorCancha?.length) return divisionRepository.create({ ...divisionData, estadoLigaId });

    // Rows, scalars and the derived summary must land together, and generation re-reads the
    // division under this same lock.
    return prisma.$transaction(async (tx) => {
      await acquireLeagueScheduleLock(tx, data.ligaId);
      await assertCourtsUsable(tx, data.ligaId, horariosPorCancha);
      const summary = summarizeDivisionSchedule(horariosPorCancha);
      return tx.division.create({
        data: {
          ...divisionData,
          estadoLigaId,
          ...summary,
          canchaHorarios: { create: horariosPorCancha.map((row) => ({ ...row })) },
        },
        include: { canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } } },
      }) as Promise<DivisionEntity>;
    }, { isolationLevel: 'ReadCommitted' });
  },

  async update(
    id: string,
    data: Partial<DivisionEntity> & { horariosPorCancha?: CourtScheduleRow[] },
    actor: AuthenticatedUser,
  ): Promise<DivisionEntity> {
    const division = await getDivisionUpdateContext(id, actor);
    if (data.ligaId) await assertLigaOwner(data.ligaId, actor);
    const ligaId = data.ligaId ?? division.ligaId;
    const { horariosPorCancha, ...scalarData } = data;
    const updateData: Partial<DivisionEntity> = scalarData;

    // One locked path for anything that changes what jornada generation validates against.
    const needsLock = data.registrarParticipaciones !== undefined
      || data.usarPenalesEnEmpates !== undefined
      || horariosPorCancha !== undefined;

    if (needsLock) {
      return prisma.$transaction(async (tx) => {
        const leagueIds = [...new Set([division.ligaId, ligaId])].sort();
        for (const lockedLeagueId of leagueIds) await acquireLeagueScheduleLock(tx, lockedLeagueId);

        const lockedDivision = await tx.division.findFirst({
          where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
          select: { id: true, ligaId: true, registrarParticipaciones: true, usarPenalesEnEmpates: true },
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

        let lockedUpdateData: Partial<DivisionEntity> = scalarData;
        if (horariosPorCancha !== undefined) {
          // El resumen denormalizado se reescribe junto con las filas.
          const summary = await replaceCourtSchedules(tx, id, ligaId, horariosPorCancha);
          lockedUpdateData = summary ? { ...lockedUpdateData, ...summary } : lockedUpdateData;
        }
        return divisionRepository.update(id, lockedUpdateData, tx);
      }, { isolationLevel: 'ReadCommitted' });
    }

    return divisionRepository.update(id, updateData);
  },

  async delete(id: string, actor: AuthenticatedUser, confirmName?: string): Promise<void> {
    await assertDivisionOwner(id, actor);
    if (confirmName !== undefined) {
      const division = await prisma.division.findFirst({
        where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
        select: { nombre: true },
      });
      if (division && division.nombre.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
        throw new ValidationError('El nombre no coincide. Escribe el nombre de la división para confirmar.');
      }
    }

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
    signalBackgroundJob('tag-cleanup');
  },

  /**
   * Reiniciar **no pasa por el gate de solo lectura**, junto a asignar campeón. Es precisamente la
   * acción que se hace sobre una división cerrada para reutilizarla: la división se auto-finaliza
   * al cerrarse la final, y exigir reabrirla antes sería un rodeo sin motivo.
   */
  async resetDivision(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    const { estadoLiga } = await assertDivisionOwner(divisionId, actor);

    await prisma.$transaction(async (tx) => {
      await tx.jornada.deleteMany({ where: { divisionId } });
      await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
      await tx.tablaPosicion.deleteMany({ where: { divisionId } });
      // Se archiva, no se borra: reiniciar es la forma normal de arrancar la temporada siguiente,
      // y borrarlo destruiría al campeón de cada temporada junto con el trofeo del equipo.
      await campeonRepository.archiveByDivision(tx, divisionId);
      // Y la deja utilizable: sin esto quedaría vacía pero todavía bloqueada, sin poder generar
      // siquiera el cuadro nuevo.
      if (!isDivisionWritable(estadoLiga?.codigo)) {
        const enCurso = await tx.estadoLiga.findFirst({ where: { codigo: 'EN_CURSO' }, select: { id: true } });
        if (enCurso) await tx.division.update({ where: { id: divisionId }, data: { estadoLigaId: enCurso.id } });
      }
    });
  },
};
