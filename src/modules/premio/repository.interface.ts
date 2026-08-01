import type { PremioEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface PremioRepository {
  findAll(): Promise<PremioEntity[]>;
  findById(id: string): Promise<PremioEntity | null>;
  findVisibleById(id: string, actor?: AuthenticatedUser): Promise<PremioEntity | null>;
  findByDivision(divisionId: string): Promise<PremioEntity[]>;
  findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<PremioEntity[] | null>;
  create(data: Record<string, unknown>): Promise<PremioEntity>;
  update(id: string, data: Record<string, unknown>): Promise<PremioEntity>;
  delete(id: string): Promise<void>;
}
