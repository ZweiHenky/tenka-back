import type { PartidoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface PartidoRepository {
  findAllVisible(actor?: AuthenticatedUser): Promise<PartidoEntity[]>;
  findById(id: string): Promise<PartidoEntity | null>;
  findVisibleById(id: string, actor?: AuthenticatedUser): Promise<PartidoEntity | null>;
  findByJornada(jornadaId: string): Promise<PartidoEntity[]>;
  findVisibleByJornada(jornadaId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[] | null>;
  findByRondaPlayoff(rondaPlayoffId: string): Promise<PartidoEntity[]>;
  findVisibleByRondaPlayoff(rondaPlayoffId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[] | null>;
  findAuthorizationContext(id: string): Promise<{
    id: string;
    ligaUserId: string;
    estado: string | null;
    golesLocal: number;
    golesVisitante: number;
    penalesLocal: number | null;
    penalesVisitante: number | null;
    jornadaId: string | null;
    rondaPlayoffId: string | null;
    divisionId: string | null;
    tipoPartido: string;
    equipoLocalId: string | null;
    equipoVisitanteId: string | null;
    fecha: Date | null;
    fechaFin: Date | null;
  } | null>;
  create(data: Record<string, unknown>): Promise<PartidoEntity>;
  update(id: string, data: Record<string, unknown>): Promise<PartidoEntity>;
  delete(id: string): Promise<void>;
}
