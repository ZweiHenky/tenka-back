import type { CampeonEntity, CampeonatoEquipoEntity, CampeonatoJugadorEntity, CampeonHistorialEntity, CampeonWriteData } from './entity';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../types/auth';

export interface CampeonRepository {
  /**
   * `null` = la división no existe o no es visible para el actor. `{ campeon: null }` = visible
   * pero todavía sin campeón. La distinción es la que permite responder 404 en vez de "no hay".
   */
  findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<{ campeon: CampeonEntity | null } | null>;
  /**
   * El palmarés de un equipo. No se puede derivar de `DivisionEquipo`: ese pivote es la
   * inscripción, y al sacar al equipo de la división desaparece — pero el campeonato sobrevive.
   */
  findByEquipo(equipoId: string, actor?: AuthenticatedUser): Promise<CampeonatoEquipoEntity[]>;
  /** Las divisiones donde un jugador fue campeón de goleo. */
  findByJugador(jugadorId: string, actor?: AuthenticatedUser): Promise<CampeonatoJugadorEntity[]>;
  /** Los títulos anteriores de una división, más nuevos primero. */
  findHistorialByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<CampeonHistorialEntity[]>;
  saveVigente(divisionId: string, data: CampeonWriteData, tx?: Prisma.TransactionClient): Promise<CampeonEntity>;
  archiveByDivision(tx: Prisma.TransactionClient, divisionId: string): Promise<void>;
  deleteByDivision(divisionId: string): Promise<void>;
}
