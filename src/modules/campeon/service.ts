import { prisma } from '../../config/database';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import type { AuthenticatedUser } from '../../types/auth';
import { goleadoresService } from '../goleadores/service';
import { campeonRepository } from './repository';
import type { CampeonEntity } from './entity';
import type { AssignInput } from './validator';

async function assertDivisionOwner(divisionId: string, actor: AuthenticatedUser): Promise<boolean> {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { registrarGoleo: true, liga: { select: { userId: true } } },
  });
  if (!division) throw new NotFoundError('División');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
  return division.registrarGoleo;
}

/**
 * El campeón sale de la final, así que no se puede declarar antes de jugarla.
 *
 * La final es la ronda de `orden` máximo, no la que se llama "Final": el nombre es texto libre y
 * la API deja editarlo.
 */
async function assertCuadroCompleto(divisionId: string): Promise<void> {
  const ultimaRonda = await prisma.rondaPlayoff.findFirst({
    where: { divisionId },
    orderBy: { orden: 'desc' },
    select: { partidos: { select: { estado: true } } },
  });
  const partidos = ultimaRonda?.partidos ?? [];
  if (partidos.length === 0 || partidos.some((partido) => partido.estado !== 'FINALIZADO')) {
    throw new ValidationError('Termina todos los partidos de la última ronda antes de asignar al campeón.');
  }
}

export const campeonService = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<CampeonEntity | null> {
    const division = await campeonRepository.findVisibleByDivision(divisionId, actor);
    if (!division) throw new NotFoundError('División');
    return division.campeon;
  },

  async assign(divisionId: string, data: AssignInput, actor: AuthenticatedUser): Promise<CampeonEntity> {
    const goleoActivo = await assertDivisionOwner(divisionId, actor);
    await assertCuadroCompleto(divisionId);

    const inscripcion = await prisma.divisionEquipo.findUnique({
      where: { divisionId_equipoId: { divisionId, equipoId: data.equipoId } },
      select: { equipo: { select: { nombre: true, logo: true } } },
    });
    if (!inscripcion) throw new ValidationError('El equipo no pertenece a esta división.');

    // El goleador se resuelve contra la tabla de goleo, no contra `DivisionJugador`: de un tirón
    // valida que el jugador tenga goles en esta división y da el conteo real que se guarda.
    let goleo = { jugadorId: null as string | null, jugadorNombre: null as string | null, jugadorFoto: null as string | null, jugadorGoles: null as number | null };
    if (data.jugadorId) {
      // Con la tabla de goleo apagada no se muestra en ningún lado, así que un campeón de goleo
      // no tendría dónde verse.
      if (!goleoActivo) throw new ValidationError('La división tiene la tabla de goleo desactivada.');
      const { rows } = await goleadoresService.findByDivision(divisionId, actor);
      const fila = rows.find((row) => row.jugadorId === data.jugadorId);
      if (!fila) throw new ValidationError('Ese jugador no tiene goles registrados en la división.');
      goleo = { jugadorId: fila.jugadorId, jugadorNombre: fila.nombre, jugadorFoto: fila.foto, jugadorGoles: fila.goles };
    }

    return campeonRepository.upsert(divisionId, {
      equipoId: data.equipoId,
      equipoNombre: inscripcion.equipo.nombre,
      equipoLogo: inscripcion.equipo.logo,
      ...goleo,
    });
  },

  async remove(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);
    await campeonRepository.deleteByDivision(divisionId);
  },
};
