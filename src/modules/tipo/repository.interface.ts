import type { TipoEntity } from './entity';

export interface TipoRepository {
  findAll(): Promise<TipoEntity[]>;
  findById(id: string): Promise<TipoEntity | null>;
  create(data: { nombre: string }): Promise<TipoEntity>;
  update(id: string, data: Record<string, unknown>): Promise<TipoEntity>;
  delete(id: string): Promise<void>;
}
