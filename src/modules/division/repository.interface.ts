import type { DivisionEntity } from './entity';
import type { Prisma } from '../../generated/prisma/client';

export interface DivisionRepository {
  findAll(): Promise<DivisionEntity[]>;
  findById(id: string): Promise<DivisionEntity | null>;
  findByLiga(ligaId: string): Promise<DivisionEntity[]>;
  create(data: Record<string, unknown>): Promise<DivisionEntity>;
  update(id: string, data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<DivisionEntity>;
  delete(id: string, tx?: Prisma.TransactionClient): Promise<void>;
}
