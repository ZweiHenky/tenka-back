import { prisma } from '../../config/database';
import type { CampeonEntity, CampeonatoEquipoEntity, CampeonatoJugadorEntity, CampeonHistorialEntity, CampeonWriteData } from './entity';
import type { Prisma } from '../../generated/prisma/client';
import type { CampeonRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

/**
 * Con la división viva manda su estado de ahora. Si se borró, manda el snapshot del estado en que
 * se coronó: una división que coronó títulos En Curso y terminó su vida en borrador los conserva,
 * y solo esconde los coronados ya en borrador.
 *
 * Lo comparten el palmarés del equipo y el del jugador; dos copias de esta condición divergirían.
 */
function campeonVisibleWhere(actor?: AuthenticatedUser) {
  return [
    { division: visibleDivisionWhere(actor) },
    { divisionId: null, divisionEstadoCodigo: { not: 'BORRADOR' } },
  ];
}

/** Lo que dibuja un logro: sale de los snapshots, no de la relación con la división. */
const LOGRO_SELECT = {
  id: true,
  divisionId: true,
  createdAt: true,
  divisionNombre: true,
  ligaId: true,
  ligaNombre: true,
  ligaLogo: true,
} as const;

export const campeonRepository: CampeonRepository = {
  async findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser) {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      // Solo el vigente: los archivados son de temporadas anteriores y van al historial.
      select: { campeones: { where: { archivadoEn: null }, take: 1 } },
    });
    if (!division) return null;
    return { campeon: division.campeones[0] ?? null };
  },

  async findByEquipo(equipoId: string, actor?: AuthenticatedUser): Promise<CampeonatoEquipoEntity[]> {
    return prisma.divisionCampeon.findMany({
      where: { equipoId, OR: campeonVisibleWhere(actor) },
      orderBy: { createdAt: 'desc' },
      select: LOGRO_SELECT,
    });
  },

  /** Las divisiones donde este jugador fue campeón de goleo. Misma visibilidad que el equipo. */
  async findByJugador(jugadorId: string, actor?: AuthenticatedUser): Promise<CampeonatoJugadorEntity[]> {
    return prisma.divisionCampeon.findMany({
      where: { jugadorId, OR: campeonVisibleWhere(actor) },
      orderBy: { createdAt: 'desc' },
      select: { ...LOGRO_SELECT, jugadorGoles: true },
    });
  },

  async findHistorialByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<CampeonHistorialEntity[]> {
    return prisma.divisionCampeon.findMany({
      where: { divisionId, archivadoEn: { not: null }, division: visibleDivisionWhere(actor) },
      orderBy: { archivadoEn: 'desc' },
      select: { id: true, createdAt: true, archivadoEn: true, equipoId: true, equipoNombre: true, equipoLogo: true },
    });
  },

  /**
   * No puede ser un `upsert`: la unicidad del vigente vive en un índice **parcial**
   * (`WHERE archivadoEn IS NULL`) y Prisma no lo acepta como clave. Actualiza el vigente si existe
   * y crea si no; el índice es el respaldo contra dos creaciones a la vez.
   */
  async saveVigente(divisionId: string, data: CampeonWriteData, tx?: Prisma.TransactionClient): Promise<CampeonEntity> {
    const client = tx ?? prisma;
    const actualizados = await client.divisionCampeon.updateMany({
      where: { divisionId, archivadoEn: null },
      data,
    });
    if (actualizados.count === 0) {
      return client.divisionCampeon.create({ data: { divisionId, ...data } });
    }
    return client.divisionCampeon.findFirstOrThrow({ where: { divisionId, archivadoEn: null } });
  },

  /** Cierra la temporada: el vigente pasa a ser un título anterior. */
  async archiveByDivision(tx: Prisma.TransactionClient, divisionId: string): Promise<void> {
    await tx.divisionCampeon.updateMany({
      where: { divisionId, archivadoEn: null },
      data: { archivadoEn: new Date() },
    });
  },

  /** Solo el vigente: los archivados son historia de otras temporadas y no se tocan. */
  async deleteByDivision(divisionId: string): Promise<void> {
    await prisma.divisionCampeon.deleteMany({ where: { divisionId, archivadoEn: null } });
  },
};
