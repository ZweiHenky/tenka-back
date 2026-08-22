import type { JornadaEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

export interface JornadaDeleteContext {
  divisionId: string;
  ligaId: string;
  ligaUserId: string;
  estadoLiga: { codigo: string };
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
    id: string;
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
  findGenerationHistory(divisionId: string, client?: Prisma.TransactionClient | PrismaClient): Promise<JornadaGenerationHistory[]>;
  findVisibleByDivision(divisionId: string, options?: { skip?: number; take?: number }, actor?: AuthenticatedUser): Promise<PaginatedResult<JornadaEntity> | null>;
  findDeleteContext(id: string, actor: AuthenticatedUser, client?: Prisma.TransactionClient | PrismaClient): Promise<JornadaDeleteContext | null>;
  delete(id: string): Promise<void>;
}
