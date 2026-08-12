import type { UbicacionEntity } from './entity';
import type { PaginatedResult, Pagination } from '../../utils/pagination';

export interface UbicacionRepository {
  findAll(): Promise<UbicacionEntity[]>;
  findAllPaginated(pagination: Pagination): Promise<PaginatedResult<UbicacionEntity>>;
  findById(id: string): Promise<UbicacionEntity | null>;
  findOrCreate(data: { lat: number; lng: number; nombreCompleto: string; estado: string; municipio: string }): Promise<UbicacionEntity>;
  create(data: Record<string, unknown>): Promise<UbicacionEntity>;
  update(id: string, data: Record<string, unknown>): Promise<UbicacionEntity>;
  delete(id: string): Promise<void>;
}
