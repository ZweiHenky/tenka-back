import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../types/auth';
import type { PartidoOcupacion } from './entity';
import type { DisponibilidadCanchaRepository } from './repository.interface';

export const disponibilidadCanchaRepository: DisponibilidadCanchaRepository = {
  findLeagueContext(ligaId: string, actor: AuthenticatedUser) {
    return prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
      select: {
        id: true,
        multiplesCanchas: true,
        canchas: {
          where: { activa: true },
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          select: { id: true, nombre: true },
        },
      },
    });
  },

  async findOccupancy(ligaId: string, inicio: Date, fin: Date): Promise<PartidoOcupacion[]> {
    const partidos = await prisma.partido.findMany({
      where: {
        fecha: { lt: fin },
        fechaFin: { gt: inicio },
        OR: [
          { jornada: { division: { ligaId } } },
          { rondaPlayoff: { division: { ligaId } } },
        ],
      },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fecha: true,
        fechaFin: true,
        canchaId: true,
        jornada: { select: { division: { select: { id: true, nombre: true } } } },
        rondaPlayoff: { select: { division: { select: { id: true, nombre: true } } } },
      },
    });

    return partidos.map((partido) => ({
      id: partido.id,
      fecha: partido.fecha!,
      fechaFin: partido.fechaFin!,
      canchaId: partido.canchaId,
      division: (partido.jornada?.division ?? partido.rondaPlayoff?.division)!,
    }));
  },
};
