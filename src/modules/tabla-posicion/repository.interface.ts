import type { TablaPosicionEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface DivisionStandingsRead {
  tablaPosiciones: TablaPosicionEntity[];
  equipos: {
    equipoId: string;
    equipo: { id: string; nombre: string; logo: string | null };
  }[];
}

export interface DivisionStandingRead {
  tablaPosiciones: TablaPosicionEntity[];
}

export interface TablaPosicionRepository {
  findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<DivisionStandingsRead | null>;
  findOne(divisionId: string, equipoId: string, actor?: AuthenticatedUser): Promise<DivisionStandingRead | null>;
  upsert(divisionId: string, equipoId: string, data: Record<string, unknown>): Promise<TablaPosicionEntity>;
  delete(divisionId: string, equipoId: string): Promise<void>;
}
