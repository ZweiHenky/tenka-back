import type { LigaEntity, ProgramacionRecienteLigaDto } from './entity';
import type { LigaArbitroEntity, LigaCanchaEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface LigaFilterParams {
  page: number;
  limit: number;
  search?: string;
  categoriaId?: string;
  tipoId?: string;
  estadoLigaId?: string;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

export interface LigaUpdateContext {
  logo: string | null;
  logoPublicId: string | null;
  cancha: string | null;
  canchaPublicId: string | null;
  multiplesCanchas: boolean;
  usaArbitros: boolean;
  canchas: { nombre: string }[];
  arbitros: { nombre: string }[];
}

export interface LigaDeleteContext {
  logo: string | null;
  logoPublicId: string | null;
  cancha: string | null;
  canchaPublicId: string | null;
}

export interface LigaManagementContext {
  multiplesCanchas: boolean;
  usaArbitros: boolean;
}

export interface LigaRepository {
  findAll(): Promise<LigaEntity[]>;
  findById(id: string): Promise<LigaEntity | null>;
  findVisibleById(id: string, actor?: AuthenticatedUser): Promise<LigaEntity | null>;
  findPublicById(id: string): Promise<LigaEntity | null>;
  findUpdateContext(id: string, actor: AuthenticatedUser): Promise<LigaUpdateContext | null>;
  findDeleteContext(id: string, actor: AuthenticatedUser): Promise<LigaDeleteContext | null>;
  findManagementContext(id: string, actor: AuthenticatedUser): Promise<LigaManagementContext | null>;
  findManageableCanchas(ligaId: string, actor: AuthenticatedUser): Promise<LigaCanchaEntity[] | null>;
  findManageableArbitros(ligaId: string, actor: AuthenticatedUser): Promise<LigaArbitroEntity[] | null>;
  findRecentSchedule(ligaId: string, actor: AuthenticatedUser): Promise<ProgramacionRecienteLigaDto | null>;
  findByNormalizedName(nombreNormalizado: string, excludeId?: string): Promise<{ id: string } | null>;
  findByUser(userId: string): Promise<LigaEntity[]>;
  findPublicByUser(userId: string): Promise<LigaEntity[]>;
  findAllPaginated(params: LigaFilterParams): Promise<PaginatedResult<LigaEntity>>;
  create(data: Record<string, unknown>, canchas?: { nombre: string }[], arbitros?: { nombre: string }[]): Promise<LigaEntity>;
  update(id: string, data: Record<string, unknown>, canchas?: { nombre: string }[], arbitros?: { nombre: string }[]): Promise<LigaEntity>;
  delete(id: string): Promise<void>;
}
