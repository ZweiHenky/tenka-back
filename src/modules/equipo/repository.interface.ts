import type { EquipoEntity } from './entity';

export interface EquipoRepository {
  findAll(): Promise<EquipoEntity[]>;
  findByUser(userId: string): Promise<EquipoEntity[]>;
  findById(id: string): Promise<EquipoEntity | null>;
  findByNormalizedName(userId: string, nombreNormalizado: string, excludeId?: string): Promise<EquipoEntity | null>;
  create(data: Record<string, unknown>): Promise<EquipoEntity>;
  update(id: string, data: Record<string, unknown>): Promise<EquipoEntity>;
  delete(id: string): Promise<void>;
}
