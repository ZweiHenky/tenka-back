import { prisma } from '../../config/database';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { isCuadroCompleto } from '../../utils/bracketCompletion';
import type { AuthenticatedUser } from '../../types/auth';
import { goleadoresService } from '../goleadores/service';
import { campeonRepository } from './repository';
import type { CampeonEntity, CampeonatoEquipoEntity, CampeonatoJugadorEntity, CampeonHistorialEntity } from './entity';
import type { AssignInput } from './validator';
import { observeResourceAccessShadowInTransaction } from '../billing/resourceAccessShadow';

/**
 * Autoriza y de paso devuelve lo que hay que congelar en el título: los snapshots los escribe el
 * servidor leyendo la base, nunca el cliente. Sale del mismo `select` que ya se hacía.
 */
async function loadDivisionForWrite(divisionId: string, actor: AuthenticatedUser) {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: {
      registrarGoleo: true,
      nombre: true,
      estadoLiga: { select: { codigo: true } },
      liga: { select: { id: true, nombre: true, logo: true, userId: true } },
    },
  });
  if (!division) throw new NotFoundError('División');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
  return division;
}

/** El campeón sale de la final, así que no se puede declarar antes de jugarla. */
async function assertCuadroCompleto(divisionId: string): Promise<void> {
  if (!(await isCuadroCompleto(prisma, divisionId))) {
    throw new ValidationError('Termina todos los partidos de la última ronda antes de asignar al campeón.');
  }
}

export const campeonService = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<CampeonEntity | null> {
    const division = await campeonRepository.findVisibleByDivision(divisionId, actor);
    if (!division) throw new NotFoundError('División');
    return division.campeon;
  },

  async findByEquipo(equipoId: string, actor?: AuthenticatedUser): Promise<CampeonatoEquipoEntity[]> {
    return campeonRepository.findByEquipo(equipoId, actor);
  },

  async findByJugador(jugadorId: string, actor?: AuthenticatedUser): Promise<CampeonatoJugadorEntity[]> {
    return campeonRepository.findByJugador(jugadorId, actor);
  },

  async findHistorialByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<CampeonHistorialEntity[]> {
    return campeonRepository.findHistorialByDivision(divisionId, actor);
  },

  async assign(divisionId: string, data: AssignInput, actor: AuthenticatedUser): Promise<CampeonEntity> {
    const division = await loadDivisionForWrite(divisionId, actor);
    const goleoActivo = division.registrarGoleo;
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

    return prisma.$transaction(async (tx) => {
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'champion.assign', capability: 'MANAGE_DIVISION', actor, divisionId, resourceType: 'DIVISION',
      });
      return campeonRepository.saveVigente(divisionId, {
        divisionNombre: division.nombre,
        ligaId: division.liga.id,
        ligaNombre: division.liga.nombre,
        ligaLogo: division.liga.logo,
        divisionEstadoCodigo: division.estadoLiga.codigo,
        equipoId: data.equipoId,
        equipoNombre: inscripcion.equipo.nombre,
        equipoLogo: inscripcion.equipo.logo,
        ...goleo,
      }, tx);
    });
  },

  async remove(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    await loadDivisionForWrite(divisionId, actor);
    await prisma.$transaction(async (tx) => {
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'champion.remove', capability: 'MANAGE_DIVISION', actor, divisionId, resourceType: 'DIVISION',
      });
      await tx.divisionCampeon.deleteMany({ where: { divisionId, archivadoEn: null } });
    });
  },
};
