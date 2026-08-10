import type { AuthenticatedUser } from '../../types/auth';
import type { LigaDisponibilidadContext, PartidoOcupacion } from './entity';

export interface DisponibilidadCanchaRepository {
  findLeagueContext(ligaId: string, actor: AuthenticatedUser): Promise<LigaDisponibilidadContext | null>;
  findOccupancy(ligaId: string, inicio: Date, fin: Date): Promise<PartidoOcupacion[]>;
}
