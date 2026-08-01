import type { RondaPlayoffEntity, RondaPlayoffReadEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';

export interface RondaPlayoffRepository {
  findAll(): Promise<RondaPlayoffEntity[]>;
  findById(id: string): Promise<RondaPlayoffEntity | null>;
  findVisibleById(id: string, actor?: AuthenticatedUser): Promise<RondaPlayoffEntity | null>;
  findByDivision(divisionId: string): Promise<RondaPlayoffEntity[]>;
  findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<RondaPlayoffReadEntity[] | null>;
  create(data: Record<string, unknown>): Promise<RondaPlayoffEntity>;
  update(id: string, data: Record<string, unknown>): Promise<RondaPlayoffEntity>;
  delete(id: string): Promise<void>;
  deleteByDivision(divisionId: string): Promise<void>;
}
