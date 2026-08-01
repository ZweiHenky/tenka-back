import type { CategoriaEntity } from './entity';

export interface CategoriaRepository {
  findAll(): Promise<CategoriaEntity[]>;
  findById(id: string): Promise<CategoriaEntity | null>;
  create(data: { nombre: string }): Promise<CategoriaEntity>;
  update(id: string, data: Record<string, unknown>): Promise<CategoriaEntity>;
  delete(id: string): Promise<void>;
}
