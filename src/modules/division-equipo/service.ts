import { NotFoundError, ValidationError } from '../../utils/errors';
import { divisionEquipoRepository } from './repository';
import { prisma } from '../../config/database';
import type { DivisionEquipoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { isAdmin } from '../../utils/authorization';

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

  async delete(divisionId: string, equipoId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);
    await prisma.$transaction(async (tx) => {
      await divisionEquipoRepository.delete(divisionId, equipoId, tx);
      await tx.tablaPosicion.deleteMany({ where: { divisionId, equipoId } });
    });
  },
};
