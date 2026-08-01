import type { UbicacionEntity } from './entity';

export interface UbicacionRepository {
  findAll(): Promise<UbicacionEntity[]>;
  findById(id: string): Promise<UbicacionEntity | null>;
  findOrCreate(data: { lat: number; lng: number; nombreCompleto: string; estado: string; municipio: string }): Promise<UbicacionEntity>;
  create(data: Record<string, unknown>): Promise<UbicacionEntity>;
  update(id: string, data: Record<string, unknown>): Promise<UbicacionEntity>;
  delete(id: string): Promise<void>;
}
