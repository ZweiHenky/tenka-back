import type { EstadoLigaEntity } from './entity';

export interface EstadoLigaRepository {
  findAll(): Promise<EstadoLigaEntity[]>;
  findById(id: string): Promise<EstadoLigaEntity | null>;
  create(data: { nombre: string; codigo: string }): Promise<EstadoLigaEntity>;
  update(id: string, data: Record<string, unknown>): Promise<EstadoLigaEntity>;
  delete(id: string): Promise<void>;
}
