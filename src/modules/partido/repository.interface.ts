import type { PartidoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { PaginatedResult, Pagination } from '../../utils/pagination';

export interface PartidoRepository {
  findAllVisible(actor?: AuthenticatedUser): Promise<PartidoEntity[]>;
  findAllVisiblePaginated(pagination: Pagination, actor?: AuthenticatedUser): Promise<PaginatedResult<PartidoEntity>>;
  findById(id: string): Promise<PartidoEntity | null>;
  findVisibleById(id: string, actor?: AuthenticatedUser): Promise<PartidoEntity | null>;
  findByJornada(jornadaId: string): Promise<PartidoEntity[]>;
  findVisibleByJornada(jornadaId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[] | null>;
  findByRondaPlayoff(rondaPlayoffId: string): Promise<PartidoEntity[]>;
  findVisibleByRondaPlayoff(rondaPlayoffId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[] | null>;
  findAuthorizationContext(id: string, client?: PrismaClient | Prisma.TransactionClient): Promise<{
    id: string;
    version?: number;
    ligaUserId: string;
    ligaId: string;
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
    canchaId: string | null;
    multiplesCanchas: boolean;
  } | null>;
  create(data: Record<string, unknown>): Promise<PartidoEntity>;
  update(id: string, data: Record<string, unknown>, client?: PrismaClient | Prisma.TransactionClient): Promise<PartidoEntity>;
  delete(id: string, client?: PrismaClient | Prisma.TransactionClient): Promise<PartidoEntity>;
}
