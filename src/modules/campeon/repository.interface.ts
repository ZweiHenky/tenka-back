import type { CampeonEntity, CampeonWriteData } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface CampeonRepository {
  /**
   * `null` = la división no existe o no es visible para el actor. `{ campeon: null }` = visible
   * pero todavía sin campeón. La distinción es la que permite responder 404 en vez de "no hay".
   */
  findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<{ campeon: CampeonEntity | null } | null>;
  upsert(divisionId: string, data: CampeonWriteData): Promise<CampeonEntity>;
  deleteByDivision(divisionId: string): Promise<void>;
}
