import type { TipoCompetenciaEntity } from './entity';

export interface TipoCompetenciaRepository {
  findAll(): Promise<TipoCompetenciaEntity[]>;
  findById(id: string): Promise<TipoCompetenciaEntity | null>;
  create(data: { nombre: string; codigo: string }): Promise<TipoCompetenciaEntity>;
  update(id: string, data: Record<string, unknown>): Promise<TipoCompetenciaEntity>;
  delete(id: string): Promise<void>;
}
