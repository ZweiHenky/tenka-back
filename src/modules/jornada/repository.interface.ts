import type { JornadaEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

export interface JornadaDeleteContext {
  divisionId: string;
  latestJornadaId: string | null;
  hasFinalizados: boolean;
  playoffPartidos: Array<{
    id: string;
    rondaPlayoffId: string;
    llave: number;
  }>;
}

export interface JornadaGenerationHistory {
  id: string;
  numero: number;
  fechaInicio: Date | null;
  partidos: Array<{
    equipoLocalId: string | null;
    equipoVisitanteId: string | null;
    tipoPartido: 'REGULAR' | 'COMPLEMENTO' | 'AMISTOSO' | 'ELIMINATORIA';
    fecha: Date | null;
  }>;
}

export interface JornadaRepository {
  findAll(): Promise<JornadaEntity[]>;
  findById(id: string): Promise<JornadaEntity | null>;
  findVisibleById(id: string, actor?: AuthenticatedUser): Promise<JornadaEntity | null>;
  findByDivision(divisionId: string, options?: { skip?: number; take?: number }): Promise<PaginatedResult<JornadaEntity>>;
  findGenerationHistory(divisionId: string): Promise<JornadaGenerationHistory[]>;
  findVisibleByDivision(divisionId: string, options?: { skip?: number; take?: number }, actor?: AuthenticatedUser): Promise<PaginatedResult<JornadaEntity> | null>;
  findUpdateContext(id: string, actor: AuthenticatedUser): Promise<{ id: string } | null>;
  findDeleteContext(id: string, actor: AuthenticatedUser): Promise<JornadaDeleteContext | null>;
  create(data: Record<string, unknown>): Promise<JornadaEntity>;
  update(id: string, data: Record<string, unknown>): Promise<JornadaEntity>;
  delete(id: string): Promise<void>;
}
