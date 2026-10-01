import { prisma } from '../../config/database';
import type { DivisionEquipoEntity } from './entity';
import type { DivisionEquipoRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import type { Prisma } from '../../generated/prisma/client';

export const divisionEquipoRepository: DivisionEquipoRepository = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<DivisionEquipoEntity[] | null> {
    const includeSaldo = actor !== undefined;
    const includeOwner = includeSaldo && actor.rol !== 'ADMINISTRADOR';
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: {
        equipos: {
          orderBy: { equipo: { nombre: 'asc' } },
          select: {
            divisionId: true,
            equipoId: true,
            ...(includeSaldo ? { saldoPendiente: true } : {}),
            equipo: { select: { id: true, nombre: true, logo: true, userId: true } },
          },
        },
        ...(includeOwner ? { liga: { select: { userId: true } } } : {}),
      },
    });
    if (!division) return null;

    const canViewSaldo = actor?.rol === 'ADMINISTRADOR'
      || (includeOwner && 'liga' in division && division.liga.userId === actor?.id);
    return division.equipos.map((pivot) => ({
      divisionId: pivot.divisionId,
      equipoId: pivot.equipoId,
      equipo: pivot.equipo,
      ...(canViewSaldo && 'saldoPendiente' in pivot
        ? { saldoPendiente: pivot.saldoPendiente.toFixed(2) }
        : {}),
    }));
  },

  async findByEquipo(equipoId: string, actor?: AuthenticatedUser): Promise<DivisionEquipoEntity[]> {
    return prisma.divisionEquipo.findMany({
      where: { equipoId, division: visibleDivisionWhere(actor) },
      select: {
        divisionId: true,
        equipoId: true,
        division: {
          include: {
            liga: { select: { id: true, nombre: true, logo: true } },
            categoria: { select: { id: true, nombre: true } },
            estadoLiga: { select: { id: true, nombre: true } },
            // Para el distintivo de campeón en la ficha del equipo. Incluye los títulos
            // archivados: el equipo ganó esa división aunque después se rehiciera el cuadro.
            campeones: { select: { equipoId: true } },
          },
        },
      },
    }) as any;
  },

  async create(data: { divisionId: string; equipoId: string }, tx?: Prisma.TransactionClient): Promise<DivisionEquipoEntity> {
    const pivot = await (tx ?? prisma).divisionEquipo.create({ data });
    return {
      divisionId: pivot.divisionId,
      equipoId: pivot.equipoId,
      saldoPendiente: pivot.saldoPendiente.toFixed(2),
    };
  },

  async updateSaldoPendiente(divisionId, equipoId, saldoPendiente, actor, tx): Promise<boolean> {
    const result = await (tx ?? prisma).divisionEquipo.updateMany({
      where: {
        divisionId,
        equipoId,
        ...(actor.rol === 'ADMINISTRADOR' ? {} : { division: { liga: { userId: actor.id } } }),
      },
      data: { saldoPendiente },
    });
    return result.count === 1;
  },

  async delete(divisionId: string, equipoId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? prisma).divisionEquipo.delete({ where: { divisionId_equipoId: { divisionId, equipoId } } });
  },
};
