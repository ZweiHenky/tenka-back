import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { divisionEquipoRepository } from './repository';
import { prisma } from '../../config/database';
import type { DivisionEquipoEntity, ReemplazoDivisionEquipoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { isAdmin } from '../../utils/authorization';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';

const replacementConflictMessage = 'Los equipos de la división cambiaron durante el reemplazo; vuelve a intentarlo';

function divisionMatchWhere(divisionId: string) {
  return {
    OR: [
      { jornada: { divisionId } },
      { rondaPlayoff: { divisionId } },
    ],
  };
}

async function assertDivisionOwner(divisionId: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
    select: { id: true },
  });
  if (!division) throw new NotFoundError('División');
}

export const divisionEquipoService = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<DivisionEquipoEntity[]> {
    const equipos = await divisionEquipoRepository.findByDivision(divisionId, actor);
    if (!equipos) throw new NotFoundError('División');
    return equipos;
  },

  async findByEquipo(equipoId: string, actor?: AuthenticatedUser): Promise<DivisionEquipoEntity[]> {
    return divisionEquipoRepository.findByEquipo(equipoId, actor);
  },

  async create(data: { divisionId: string; equipoId: string }, actor: AuthenticatedUser): Promise<DivisionEquipoEntity> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const division = await tx.division.findFirst({
            where: isAdmin(actor) ? { id: data.divisionId } : { id: data.divisionId, liga: { userId: actor.id } },
            select: { maxEquipos: true },
          });
          if (!division) throw new NotFoundError('División');

          const count = await tx.divisionEquipo.count({ where: { divisionId: data.divisionId } });
          if (count >= division.maxEquipos) {
            throw new ValidationError(`La división ya alcanzó el máximo de ${division.maxEquipos} equipos`);
          }

          return divisionEquipoRepository.create(data, tx);
        }, { isolationLevel: 'Serializable' });
      } catch (error: any) {
        if (error?.code !== 'P2034' || attempt >= 2) throw error;
      }
    }
  },

  async updateSaldoPendiente(
    divisionId: string,
    equipoId: string,
    saldoPendiente: string,
    actor: AuthenticatedUser,
  ): Promise<DivisionEquipoEntity> {
    const updated = await divisionEquipoRepository.updateSaldoPendiente(
      divisionId,
      equipoId,
      saldoPendiente,
      actor,
    );
    if (!updated) throw new NotFoundError('Equipo de la división');
    return { divisionId, equipoId, saldoPendiente };
  },

  async reemplazo(
    divisionId: string,
    equipoActualId: string,
    equipoNuevoId: string,
    actor: AuthenticatedUser,
  ): Promise<ReemplazoDivisionEquipoEntity> {
    if (equipoActualId === equipoNuevoId) {
      throw new ValidationError('El equipo nuevo debe ser diferente al equipo actual');
    }

    const authorizationWhere = isAdmin(actor)
      ? { id: divisionId }
      : { id: divisionId, liga: { userId: actor.id } };
    const preflight = await prisma.division.findFirst({
      where: authorizationWhere,
      select: { ligaId: true },
    });
    if (!preflight) throw new NotFoundError('División');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          await acquireLeagueScheduleLock(tx, preflight.ligaId);

          const division = await tx.division.findFirst({
            where: authorizationWhere,
            select: { ligaId: true },
          });
          if (!division) throw new NotFoundError('División');
          if (division.ligaId !== preflight.ligaId) throw new ConflictError(replacementConflictMessage);

          const sourcePivot = await tx.divisionEquipo.findUnique({
            where: { divisionId_equipoId: { divisionId, equipoId: equipoActualId } },
            select: { saldoPendiente: true },
          });
          if (!sourcePivot) throw new NotFoundError('Equipo de la división');

          const target = await tx.equipo.findUnique({
            where: { id: equipoNuevoId },
            select: { id: true, nombre: true, logo: true, userId: true },
          });
          if (!target) throw new NotFoundError('Equipo nuevo');

          const [targetPivot, targetMatch, sourcePlayers, sourceParticipation, sourceScoring, targetStanding] = await Promise.all([
            tx.divisionEquipo.findUnique({
              where: { divisionId_equipoId: { divisionId, equipoId: equipoNuevoId } },
              select: { equipoId: true },
            }),
            tx.partido.findFirst({
              where: {
                AND: [
                  divisionMatchWhere(divisionId),
                  { OR: [{ equipoLocalId: equipoNuevoId }, { equipoVisitanteId: equipoNuevoId }] },
                ],
              },
              select: { id: true },
            }),
            tx.divisionJugador.findFirst({
              where: { divisionId, equipoId: equipoActualId },
              select: { jugadorId: true },
            }),
            tx.participacionPartido.findFirst({
              where: {
                partido: divisionMatchWhere(divisionId),
                OR: [
                  { equipoId: equipoActualId },
                  { equipoIdSnapshot: equipoActualId },
                  { ladoMarcador: 'LOCAL', partido: { equipoLocalId: equipoActualId } },
                  { ladoMarcador: 'VISITANTE', partido: { equipoVisitanteId: equipoActualId } },
                ],
              },
              select: { id: true },
            }),
            tx.anotacionPartido.findFirst({
              where: {
                jugadorIdSnapshot: { not: null },
                partido: divisionMatchWhere(divisionId),
                OR: [
                  { equipoId: equipoActualId },
                  { equipoIdSnapshot: equipoActualId },
                  { ladoMarcador: 'LOCAL', partido: { equipoLocalId: equipoActualId } },
                  { ladoMarcador: 'VISITANTE', partido: { equipoVisitanteId: equipoActualId } },
                ],
              },
              select: { id: true },
            }),
            tx.tablaPosicion.findUnique({
              where: { divisionId_equipoId: { divisionId, equipoId: equipoNuevoId } },
              select: { id: true },
            }),
          ]);

          if (targetPivot) throw new ConflictError('El equipo nuevo ya está inscrito en la división');
          if (targetMatch) throw new ConflictError('El equipo nuevo ya aparece en partidos de la división');
          if (sourcePlayers) throw new ConflictError('El equipo actual todavía tiene jugadores inscritos en la división');
          if (sourceParticipation || sourceScoring) {
            throw new ConflictError('El equipo actual tiene historial atribuido a jugadores y no puede reemplazarse');
          }
          if (targetStanding) throw new ConflictError('El equipo nuevo tiene una tabla de posiciones incompatible en la división');

          const sourceMatches = await tx.partido.findMany({
            where: {
              AND: [
                divisionMatchWhere(divisionId),
                { OR: [{ equipoLocalId: equipoActualId }, { equipoVisitanteId: equipoActualId }] },
              ],
            },
            select: { id: true, equipoLocalId: true, equipoVisitanteId: true },
          });
          const sourceMatchIds = sourceMatches.map(({ id }) => id);
          const selfMatchIds = sourceMatches
            .filter((match) => match.equipoLocalId === equipoActualId && match.equipoVisitanteId === equipoActualId)
            .map(({ id }) => id);
          const localMatchIds = sourceMatches
            .filter((match) => match.equipoLocalId === equipoActualId && match.equipoVisitanteId !== equipoActualId)
            .map(({ id }) => id);
          const visitorMatchIds = sourceMatches
            .filter((match) => match.equipoVisitanteId === equipoActualId && match.equipoLocalId !== equipoActualId)
            .map(({ id }) => id);

          await tx.divisionEquipo.create({
            data: { divisionId, equipoId: equipoNuevoId, saldoPendiente: sourcePivot.saldoPendiente },
          });
          if (sourceMatchIds.length > 0) {
            await tx.anotacionPartido.updateMany({
              where: {
                partidoId: { in: sourceMatchIds },
                jugadorIdSnapshot: null,
                OR: [
                  { equipoId: equipoActualId },
                  { equipoIdSnapshot: equipoActualId },
                  { ladoMarcador: 'LOCAL', partido: { equipoLocalId: equipoActualId } },
                  { ladoMarcador: 'VISITANTE', partido: { equipoVisitanteId: equipoActualId } },
                ],
              },
              data: { equipoId: equipoNuevoId, equipoIdSnapshot: equipoNuevoId, equipoNombre: target.nombre },
            });
            if (selfMatchIds.length > 0) {
              await tx.partido.updateMany({
                where: { id: { in: selfMatchIds } },
                data: {
                  equipoLocalId: equipoNuevoId,
                  equipoVisitanteId: equipoNuevoId,
                  version: { increment: 1 },
                },
              });
            }
            if (localMatchIds.length > 0) {
              await tx.partido.updateMany({
                where: { id: { in: localMatchIds } },
                data: { equipoLocalId: equipoNuevoId, version: { increment: 1 } },
              });
            }
            if (visitorMatchIds.length > 0) {
              await tx.partido.updateMany({
                where: { id: { in: visitorMatchIds } },
                data: { equipoVisitanteId: equipoNuevoId, version: { increment: 1 } },
              });
            }
          }
          await tx.tablaPosicion.updateMany({
            where: { divisionId, equipoId: equipoActualId },
            data: { equipoId: equipoNuevoId },
          });
          await tx.divisionCampeon.updateMany({
            where: { divisionId, equipoId: equipoActualId },
            data: { equipoId: equipoNuevoId, equipoNombre: target.nombre, equipoLogo: target.logo },
          });
          await tx.divisionEquipo.delete({
            where: { divisionId_equipoId: { divisionId, equipoId: equipoActualId } },
          });

          return {
            divisionId,
            equipoId: equipoNuevoId,
            saldoPendiente: sourcePivot.saldoPendiente.toFixed(2),
            equipo: target,
            equipoReemplazadoId: equipoActualId,
            partidosActualizados: sourceMatchIds.length,
          };
        }, { isolationLevel: 'Serializable' });
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) continue;
        if (error?.code === 'P2034' || error?.code === 'P2002') {
          throw new ConflictError(replacementConflictMessage);
        }
        throw error;
      }
    }
    throw new ConflictError(replacementConflictMessage);
  },

  async delete(divisionId: string, equipoId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);
    await prisma.$transaction(async (tx) => {
      await divisionEquipoRepository.delete(divisionId, equipoId, tx);
      await tx.tablaPosicion.deleteMany({ where: { divisionId, equipoId } });
    });
  },
};
