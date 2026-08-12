import type { EquipoEntity } from './entity';
import type { Prisma } from '../../generated/prisma/client';
import type { PaginatedResult, Pagination } from '../../utils/pagination';

export interface EquipoRepository {
  findAll(): Promise<EquipoEntity[]>;
  findAllPaginated(pagination: Pagination): Promise<PaginatedResult<EquipoEntity>>;
  findByUser(userId: string): Promise<EquipoEntity[]>;
  findById(id: string): Promise<EquipoEntity | null>;
  findByNormalizedName(userId: string, nombreNormalizado: string, excludeId?: string): Promise<EquipoEntity | null>;
  create(data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<EquipoEntity>;
  update(id: string, data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<EquipoEntity>;
  delete(id: string, tx?: Prisma.TransactionClient): Promise<void>;
}
