import { AppError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
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
import { acquireAccountQuotaLock, assertAccountQuotaDelta, isActiveDivisionCode } from '../../utils/accountQuota';
import {
  assertMigrationAllowsResourceCreation,
  closeFreeManagementGrantForDeletedResource,
  ensureInitialFreeManagementGrant,
  resolveAccountAccessPolicy,
} from '../billing/service';
import { observeResourceAccessShadowInTransaction } from '../billing/resourceAccessShadow';
import { assignDivisionCapacityInTransaction } from '../billing/capacityAssignment';
import { env } from '../../config/env';
import { resolveDivisionAccessShadowInTransaction } from '../billing/resourceAccessResolver';

async function assertLigaOwner(ligaId: string, actor: AuthenticatedUser): Promise<{ id: string; userId: string }> {
  const liga = await prisma.liga.findFirst({
    where: isAdmin(actor) ? { id: ligaId } : { id: ligaId, userId: actor.id },
    select: { id: true, userId: true },
  });
  if (!liga) throw new NotFoundError('Liga');
  return liga;
}

async function assertDivisionOwner(id: string, actor: AuthenticatedUser): Promise<{ ligaId: string; ownerId: string; estadoLiga: { codigo: string } }> {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
    select: { id: true, ligaId: true, liga: { select: { userId: true } }, estadoLiga: { select: { codigo: true } } },
  });
  if (!division) throw new NotFoundError('Division');
  return { ligaId: division.ligaId, ownerId: division.liga.userId, estadoLiga: division.estadoLiga };
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
    select: {
      id: true,
      ligaId: true,
      liga: { select: { userId: true } },
      estadoLiga: { select: { codigo: true } },
      registrarParticipaciones: true,
      usarPenalesEnEmpates: true,
    },
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
    const exposesManagement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED && actor
      && (actor.rol === 'ADMINISTRADOR' || actor.id === (await prisma.liga.findUnique({
        where: { id: division.ligaId }, select: { userId: true },
      }))?.userId);
    if (exposesManagement && actor) {
      const decision = await prisma.$transaction((tx) => resolveDivisionAccessShadowInTransaction(tx, {
        divisionId: id,
        actor,
      }));
      return {
        ...division, managementAccess: decision.access, managementReason: decision.reason,
        migrationOverlayActive: decision.migrationOverlayActive,
        migrationDeadline: decision.migrationDeadline,
        migrationPaused: decision.migrationPaused,
      };
    }
    return division;
  },

  async listByLiga(ligaId: string, actor?: AuthenticatedUser): Promise<DivisionEntity[]> {
    const divisions = await prisma.division.findMany({ where: { ligaId, ...visibleDivisionWhere(actor) }, orderBy: { createdAt: 'desc' } }) as DivisionEntity[];
    if (!env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED || !actor) return divisions;
    const league = await prisma.liga.findUnique({ where: { id: ligaId }, select: { userId: true } });
    if (!league || (actor.rol !== 'ADMINISTRADOR' && actor.id !== league.userId)) return divisions;
    return prisma.$transaction(async (tx) => {
      const result: DivisionEntity[] = [];
      for (const division of divisions) {
        const decision = await resolveDivisionAccessShadowInTransaction(tx, { divisionId: division.id, actor });
        result.push({
          ...division, managementAccess: decision.access, managementReason: decision.reason,
          migrationOverlayActive: decision.migrationOverlayActive,
          migrationDeadline: decision.migrationDeadline,
          migrationPaused: decision.migrationPaused,
        });
      }
      return result;
    });
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
    const league = await assertLigaOwner(data.ligaId, actor);
    const { horariosPorCancha, ...divisionData } = data;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          await acquireAccountQuotaLock(tx, league.userId);
          await assertMigrationAllowsResourceCreation(tx, league.userId);
          const lockedLeague = await tx.liga.findFirst({
            where: isAdmin(actor) ? { id: data.ligaId, userId: league.userId } : { id: data.ligaId, userId: actor.id },
            select: { id: true, userId: true },
          });
          if (!lockedLeague) throw new NotFoundError('Liga');
          const estado = data.estadoLigaId
            ? await tx.estadoLiga.findUnique({ where: { id: data.estadoLigaId }, select: { id: true, codigo: true } })
            : await tx.estadoLiga.findFirst({ where: { codigo: 'BORRADOR' }, select: { id: true, codigo: true } });
          if (!estado) throw new NotFoundError('Estado de liga');
          await observeResourceAccessShadowInTransaction(tx, {
            operation: 'division.create', capability: 'CREATE_DIVISION', actor,
            leagueId: lockedLeague.id, resourceType: 'LEAGUE',
          });
          await assertAccountQuotaDelta(tx, lockedLeague.userId, {
            divisions: 1,
            activeDivisions: isActiveDivisionCode(estado.codigo) ? 1 : 0,
          });

          const policy = await resolveAccountAccessPolicy(lockedLeague.userId, tx);
          let paidPeriodId: string | null = null;
          if (policy.effectiveAccess === 'LOCAL_GRACE') {
            throw new AppError(
              403,
              'No se pueden consumir slots nuevos durante la gracia local',
              'BILLING_LOCAL_GRACE_READ_ONLY',
            );
          }
          if (policy.effectiveAccess === 'PAID') {
            if (!policy.canConsumePaidSlot || !policy.billingAccountId) {
              throw new AppError(422, 'No hay un slot disponible para la división', 'BILLING_CAPACITY_REQUIRED');
            }
            const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
            const period = await tx.billingPeriod.findFirst({
              where: {
                billingAccountId: policy.billingAccountId,
                effectiveStart: { lte: now },
                effectiveEnd: { gt: now },
                OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: now } }],
              },
              orderBy: [{ effectiveStart: 'desc' }, { id: 'desc' }],
              select: { id: true },
            });
            if (!period) {
              throw new AppError(409, 'No existe un periodo pagado vigente', 'BILLING_EVIDENCE_INVALID');
            }
            await tx.$queryRaw`SELECT "id" FROM billing_periods WHERE "id" = ${period.id} FOR UPDATE`;
            paidPeriodId = period.id;
          }

          if (horariosPorCancha?.length) {
            await acquireLeagueScheduleLock(tx, data.ligaId);
          }

          let created = await divisionRepository.create({ ...divisionData, estadoLigaId: estado.id }, tx);
          if (paidPeriodId) {
            await assignDivisionCapacityInTransaction(tx, {
              billingPeriodId: paidPeriodId,
              divisionId: created.id,
              assignmentSource: 'DIRECT',
            });
          } else {
            await ensureInitialFreeManagementGrant(tx, lockedLeague.userId, created.id);
          }

          if (horariosPorCancha?.length) {
            const summary = await replaceCourtSchedules(tx, created.id, data.ligaId, horariosPorCancha);
            created = await tx.division.update({
              where: { id: created.id },
              data: summary ?? {},
              include: { canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } } },
            }) as DivisionEntity;
          }
          return created;
        }, { isolationLevel: 'Serializable', timeout: 30_000 });
      } catch (error) {
        if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
        if ((error as { code?: unknown })?.code === 'P2034') {
          throw new ConflictError('La capacidad cambió durante la creación; vuelve a intentarlo');
        }
        throw error;
      }
    }
    throw new ConflictError('La capacidad cambió durante la creación; vuelve a intentarlo');
  },

  async update(
    id: string,
    data: Partial<DivisionEntity> & { horariosPorCancha?: CourtScheduleRow[] },
    actor: AuthenticatedUser,
  ): Promise<DivisionEntity> {
    const division = await getDivisionUpdateContext(id, actor);
    const ligaId = data.ligaId ?? division.ligaId;
    const { horariosPorCancha, ...scalarData } = data;
    const updateData: Partial<DivisionEntity> = scalarData;

    // One locked path for anything that changes what jornada generation validates against.
    const needsLock = data.registrarParticipaciones !== undefined
      || data.usarPenalesEnEmpates !== undefined
      || horariosPorCancha !== undefined
      || data.estadoLigaId !== undefined
      || data.ligaId !== undefined;

    if (needsLock) {
      return prisma.$transaction(async (tx) => {
        await acquireAccountQuotaLock(tx, division.liga.userId);
        await observeResourceAccessShadowInTransaction(tx, {
          operation: 'division.update', capability: 'MANAGE_DIVISION', actor, divisionId: id, resourceType: 'DIVISION',
        });
        const leagueIds = [...new Set([division.ligaId, ligaId])].sort();
        for (const lockedLeagueId of leagueIds) await acquireLeagueScheduleLock(tx, lockedLeagueId);

        const lockedDivision = await tx.division.findFirst({
          where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
          select: {
            id: true,
            ligaId: true,
            liga: { select: { userId: true } },
            estadoLiga: { select: { codigo: true } },
            registrarParticipaciones: true,
            usarPenalesEnEmpates: true,
          },
        });
        if (!lockedDivision) throw new NotFoundError('Division');
        if (lockedDivision.ligaId !== division.ligaId) {
          throw new ConflictError('La división cambió de liga durante la actualización; vuelve a intentarlo');
        }

        if (lockedDivision.liga.userId !== division.liga.userId) {
          throw new ConflictError('El propietario de la división cambió durante la actualización; vuelve a intentarlo');
        }
        if (data.ligaId) {
          const targetLeague = await tx.liga.findFirst({
            where: { id: data.ligaId },
            select: { id: true, userId: true },
          });
          if (!targetLeague) throw new NotFoundError('Liga');
          if (targetLeague.userId !== lockedDivision.liga.userId) {
            throw new ValidationError('La división solo puede moverse entre ligas del mismo propietario');
          }
        }

        if (data.estadoLigaId !== undefined) {
          const targetState = await tx.estadoLiga.findUnique({
            where: { id: data.estadoLigaId },
            select: { codigo: true },
          });
          if (!targetState) throw new NotFoundError('Estado de liga');
          const activeDelta = Number(isActiveDivisionCode(targetState.codigo))
            - Number(isActiveDivisionCode(lockedDivision.estadoLiga.codigo));
          if (activeDelta > 0) {
            await assertAccountQuotaDelta(tx, lockedDivision.liga.userId, { activeDivisions: activeDelta });
          }
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

    return prisma.$transaction(async (tx) => {
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'division.update', capability: 'MANAGE_DIVISION', actor, divisionId: id, resourceType: 'DIVISION',
      });
      return divisionRepository.update(id, updateData, tx);
    });
  },

  async delete(id: string, actor: AuthenticatedUser, confirmName?: string): Promise<void> {
    const preflight = await assertDivisionOwner(id, actor);
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
      await acquireAccountQuotaLock(tx, preflight.ownerId);
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'division.delete', capability: 'DELETE_RESOURCE', actor, divisionId: id, resourceType: 'DIVISION',
      });
      await closeFreeManagementGrantForDeletedResource(tx, preflight.ownerId, { divisionId: id });
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
    const preflight = await assertDivisionOwner(divisionId, actor);

    await prisma.$transaction(async (tx) => {
      await acquireAccountQuotaLock(tx, preflight.ownerId);
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'division.reset', capability: 'MANAGE_DIVISION', actor, divisionId, resourceType: 'DIVISION',
      });
      await acquireLeagueScheduleLock(tx, preflight.ligaId);
      const lockedDivision = await tx.division.findFirst({
        where: isAdmin(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
        select: { ligaId: true, liga: { select: { userId: true } }, estadoLiga: { select: { codigo: true } } },
      });
      if (!lockedDivision) throw new NotFoundError('Division');
      if (lockedDivision.ligaId !== preflight.ligaId) {
        throw new ConflictError('La división cambió de liga durante el reinicio; vuelve a intentarlo');
      }
      if (lockedDivision.liga.userId !== preflight.ownerId) {
        throw new ConflictError('El propietario de la división cambió durante el reinicio; vuelve a intentarlo');
      }
      const enCurso = !isDivisionWritable(lockedDivision.estadoLiga.codigo)
        ? await tx.estadoLiga.findFirst({ where: { codigo: 'EN_CURSO' }, select: { id: true } })
        : null;
      if (enCurso) {
        await assertAccountQuotaDelta(tx, preflight.ownerId, { activeDivisions: 1 });
      }
      await tx.jornada.deleteMany({ where: { divisionId } });
      await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
      await tx.tablaPosicion.deleteMany({ where: { divisionId } });
      // Se archiva, no se borra: reiniciar es la forma normal de arrancar la temporada siguiente,
      // y borrarlo destruiría al campeón de cada temporada junto con el trofeo del equipo.
      await campeonRepository.archiveByDivision(tx, divisionId);
      // Y la deja utilizable: sin esto quedaría vacía pero todavía bloqueada, sin poder generar
      // siquiera el cuadro nuevo.
      if (enCurso) {
        await tx.division.update({ where: { id: divisionId }, data: { estadoLigaId: enCurso.id } });
      }
    });
  },
};
